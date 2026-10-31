/**
 * The bounded model/tool loop for MCP-backed chats.
 *
 * Every MCP tool runs here, between two model calls, and only after the user
 * approved that exact call. The loop is deliberately boring: a fixed number of
 * rounds, a fixed number of calls, a wall-clock budget, byte caps on arguments
 * and results, and a prompt-token ceiling. Anything the model asks for outside
 * those bounds is answered with a visible tool result rather than executed.
 */
import { countTokens } from '@/src/lib/tokens';
import { messagesTokens } from './prompt-budget';
import {
  streamChat,
  type ChatMessage,
  type OutgoingToolCall,
  type StreamTrace,
  type ToolDefinition,
} from './openrouter';
import { parseToolCallArguments, toolCallKey } from './tool-stream';
import { McpDisabledError, mcpToolsEnabled } from './mcp-config';
import type { ThinkingLevel } from '@/src/config/models';

/** One tool the loop may offer to the model, plus the user's own identity for it. */
export interface LoopTool {
  /** The normalized name sent to OpenRouter. */
  name: string;
  description?: string;
  parameters?: unknown;
  connectionId: string;
  /** Stable `<server>/<tool>` identifier used for the enablement map. */
  toolId: string;
}

export type ToolLoopLimitName = 'rounds' | 'calls' | 'elapsed' | 'arguments' | 'prompt_tokens';

/** Why the loop stopped early, so the transcript can say so out loud. */
export interface ToolLoopStop {
  limit: ToolLoopLimitName;
  message: string;
}

export interface ToolLoopLimits {
  maxRounds: number;
  maxCallsPerRound: number;
  maxTotalCalls: number;
  maxElapsedMs: number;
  maxArgumentBytes: number;
  maxResultBytes: number;
  maxPromptTokens: number;
}

export const DEFAULT_TOOL_LOOP_LIMITS: ToolLoopLimits = {
  maxRounds: 4,
  maxCallsPerRound: 4,
  maxTotalCalls: 8,
  maxElapsedMs: 120_000,
  maxArgumentBytes: 8_192,
  maxResultBytes: 16_384,
  maxPromptTokens: 24_000,
};

export type ToolApprovalDecision = 'approved' | 'denied' | 'expired';

export interface ToolApprovalRequest {
  callId: string;
  name: string;
  connectionId: string;
  toolId: string;
  arguments: Record<string, unknown>;
  round: number;
  signal: AbortSignal;
}

export type ToolExecutionResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export type ToolCallStatus =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'not_approved'
  | 'invalid_arguments'
  | 'not_enabled'
  | 'too_large'
  | 'repeated'
  | 'cancelled'
  | 'timed_out';

/** One finished call, ready to persist and render. */
export interface ToolLoopCall {
  callId: string;
  name: string;
  connectionId: string;
  toolId: string;
  /** The raw JSON the model produced, never re-serialized. */
  arguments: string;
  status: ToolCallStatus;
  approval: ToolApprovalDecision | 'not_requested';
  /** The bounded text handed back to the model. */
  result: string;
  truncated: boolean;
  error?: string;
}

export type ToolLoopEvent =
  | { kind: 'approval_request'; call: Omit<ToolLoopCall, 'status' | 'approval' | 'result' | 'truncated'> }
  | { kind: 'call_started'; callId: string; name: string }
  | { kind: 'call_result'; call: ToolLoopCall }
  | { kind: 'call_failure'; call: ToolLoopCall }
  | { kind: 'discovery_failed'; connectionId: string; error: string }
  | { kind: 'stopped'; stop: ToolLoopStop };

export interface ToolLoopOptions {
  userId: string;
  model: string;
  messages: ChatMessage[];
  tools: LoopTool[];
  /** Models that reject a `tools` array must be refused before the call. */
  supportsTools: boolean;
  thinkingLevel?: ThinkingLevel;
  signal: AbortSignal;
  limits?: Partial<ToolLoopLimits>;
  trace?: StreamTrace;
  /** Per-user allowlist; a tool that is not listed is never executed. */
  isToolEnabled: (tool: LoopTool) => boolean;
  requestApproval: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  execute: (tool: LoopTool, callId: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolExecutionResult>;
  onChunk?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onEvent?: (event: ToolLoopEvent) => void;
  /** Elapsed-time source, so tests do not have to sleep. */
  now?: () => number;
}

export interface ToolLoopResult {
  content: string;
  calls: ToolLoopCall[];
  rounds: number;
  usage: { input: number; output: number };
  aborted: boolean;
  stop?: ToolLoopStop;
  /** Assistant and tool messages appended after the prompt, in OpenRouter order. */
  transcript: ChatMessage[];
}

/** Thrown when tools were requested from a model that cannot take them. */
export class ToolLoopUnsupportedModelError extends Error {
  readonly code = 'tools_unsupported_model';

  constructor(model: string) {
    super(`${model} does not support tool calling. Pick a model that does, or turn MCP tools off for this chat.`);
    this.name = 'ToolLoopUnsupportedModelError';
  }
}

const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (byteLength(text) <= maxBytes) return { text, truncated: false };
  // Cut on a character boundary so the result stays valid UTF-8.
  let end = Math.min(text.length, maxBytes);
  let slice = text.slice(0, end);
  while (byteLength(slice) > maxBytes && end > 0) {
    end -= 1;
    slice = text.slice(0, end);
  }
  return { text: `${slice}\n[truncated]`, truncated: true };
}

/**
 * Runs one chat turn to completion: model, approved tool calls, model again.
 * The returned `content` is only the assistant prose; every tool event is
 * reported through `onEvent` and returned in `calls`, and `transcript` holds
 * the exact messages to append so a later replay sees the same conversation.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const limits: ToolLoopLimits = { ...DEFAULT_TOOL_LOOP_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const startedAt = now();
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));
  const messages = options.messages.slice();
  const transcript: ChatMessage[] = [];
  const calls: ToolLoopCall[] = [];
  const usage = { input: 0, output: 0 };
  // A model that repeats a failed call is stopped rather than indulged.
  const seen = new Map<string, number>();
  const definitions: ToolDefinition[] = options.tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

  const emit = (event: ToolLoopEvent) => options.onEvent?.(event);
  const record = (call: ToolLoopCall) => {
    calls.push(call);
    // OpenRouter needs a tool answer for every call id in the assistant message.
    const message: ChatMessage = { role: 'tool', content: call.result, tool_call_id: call.callId };
    messages.push(message);
    transcript.push(message);
    if (call.status === 'completed') emit({ kind: 'call_result', call });
    else emit({ kind: 'call_failure', call });
  };

  if (options.tools.length > 0 && !mcpToolsEnabled()) {
    throw new McpDisabledError();
  }
  if (options.tools.length > 0 && !options.supportsTools) {
    throw new ToolLoopUnsupportedModelError(options.model);
  }

  let content = '';
  let rounds = 0;
  let stop: ToolLoopStop | undefined;
  /** A spent budget ends the loop; a single oversized call does not. */
  let budgetSpent = false;

  while (rounds < limits.maxRounds && !budgetSpent) {
    if (options.signal.aborted) {
      return { content, calls, rounds, usage, aborted: true, transcript };
    }
    if (now() - startedAt > limits.maxElapsedMs) {
      stop = { limit: 'elapsed', message: 'The tool budget for this turn ran out.' };
      break;
    }
    // Schemas, streamed calls and their results all cost the prompt.
    const promptTokens = messagesTokens(messages) + toolSchemaTokens(options.tools);
    if (promptTokens > limits.maxPromptTokens) {
      stop = {
        limit: 'prompt_tokens',
        message: `The conversation grew past the ${limits.maxPromptTokens.toLocaleString()} token tool budget, so no more tools were run.`,
      };
      break;
    }

    rounds += 1;
    const streamed = await streamChat(messages, options.model, {
      thinkingLevel: options.thinkingLevel,
      // An empty list must look exactly like the old tool-free call.
      tools: definitions.length > 0 ? definitions : undefined,
      signal: options.signal,
      onChunk: options.onChunk,
      onReasoning: options.onReasoning,
      trace: options.trace,
    });
    usage.input += streamed.usage.promptTokens;
    usage.output += streamed.usage.completionTokens;
    content = streamed.content ? (content ? `${content}\n\n${streamed.content}` : streamed.content) : content;

    if (streamed.aborted || options.signal.aborted) {
      return { content, calls, rounds, usage, aborted: true, stop, transcript };
    }
    if (streamed.toolCalls.length === 0) {
      return { content, calls, rounds, usage, aborted: false, stop, transcript };
    }

    const outgoing: OutgoingToolCall[] = streamed.toolCalls.map((call) => ({
      id: call.callId,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    }));
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: streamed.content || null,
      tool_calls: outgoing,
    };
    messages.push(assistantMessage);
    transcript.push(assistantMessage);

    const pending = streamed.toolCalls.slice(0, limits.maxCallsPerRound);
    const overflowed = streamed.toolCalls.slice(pending.length);

    for (let position = 0; position < pending.length; position += 1) {
      const call = pending[position];
      // Once the user stopped, the calls still waiting are closed out rather
      // than dropped: the saved turn must stay replayable.
      const closeRemaining = (status: ToolCallStatus, approval: ToolLoopCall['approval'], message: string, skip = 0) => {
        for (const rest of pending.slice(position + skip)) {
          const restTool = byName.get(rest.name);
          record({
            callId: rest.callId, name: rest.name,
            connectionId: restTool?.connectionId ?? '', toolId: restTool?.toolId ?? '',
            arguments: rest.arguments, status, approval, result: message, truncated: false,
          });
        }
      };

      if (options.signal.aborted) {
        closeRemaining('cancelled', 'not_requested', 'The user stopped this turn.');
        return { content, calls, rounds, usage, aborted: true, stop, transcript };
      }
      if (calls.length >= limits.maxTotalCalls) {
        closeRemaining('too_large', 'not_requested', `This turn reached its limit of ${limits.maxTotalCalls} tool calls.`);
        stop = { limit: 'calls', message: `This turn reached its limit of ${limits.maxTotalCalls} tool calls.` };
        budgetSpent = true;
        break;
      }
      if (now() - startedAt > limits.maxElapsedMs) {
        closeRemaining('timed_out', 'not_requested', 'This turn ran out of time before the tool was called.');
        stop = { limit: 'elapsed', message: 'The tool budget for this turn ran out.' };
        budgetSpent = true;
        break;
      }

      const tool = byName.get(call.name);
      const base = {
        callId: call.callId,
        name: call.name,
        connectionId: tool?.connectionId ?? '',
        toolId: tool?.toolId ?? '',
        arguments: call.arguments,
      };

      if (!tool) {
        record({ ...base, status: 'not_enabled', approval: 'not_requested', result: `Tool "${call.name}" is not available on this connection.`, truncated: false });
        continue;
      }
      if (!options.isToolEnabled(tool)) {
        record({ ...base, status: 'not_enabled', approval: 'not_requested', result: `The user has not enabled "${tool.name}".`, truncated: false });
        continue;
      }
      if (byteLength(call.arguments) > limits.maxArgumentBytes) {
        record({ ...base, status: 'too_large', approval: 'not_requested', result: `Those arguments are larger than the ${limits.maxArgumentBytes.toLocaleString()} byte limit, so the tool was not called.`, truncated: false });
        stop = { limit: 'arguments', message: 'A tool call exceeded the argument size limit.' };
        continue;
      }
      const parsed = parseToolCallArguments(call.arguments);
      if (!parsed.ok) {
        record({ ...base, status: 'invalid_arguments', approval: 'not_requested', result: parsed.error, truncated: false });
        continue;
      }

      const key = toolCallKey(call.name, call.arguments);
      const attempts = (seen.get(key) ?? 0) + 1;
      seen.set(key, attempts);
      if (attempts > 1) {
        record({ ...base, status: 'repeated', approval: 'not_requested', result: `This exact call already ran ${attempts - 1} time(s) this turn. Answer with what you already have.`, truncated: false });
        stop = { limit: 'calls', message: 'The model repeated a tool call it had already been answered.' };
        budgetSpent = true;
        continue;
      }

      emit({ kind: 'approval_request', call: base });
      let decision: ToolApprovalDecision;
      try {
        decision = await options.requestApproval({
          callId: call.callId, name: call.name, connectionId: tool.connectionId,
          toolId: tool.toolId, arguments: parsed.value, round: rounds, signal: options.signal,
        });
      } catch (error) {
        if (!isAbort(error)) throw error;
        record({ ...base, status: 'cancelled', approval: 'denied', result: 'The user stopped before deciding.', truncated: false });
        closeRemaining('cancelled', 'not_requested', 'The user stopped this turn.', 1);
        return { content, calls, rounds, usage, aborted: true, stop, transcript };
      }
      if (decision !== 'approved') {
        record({
          ...base,
          status: decision === 'expired' ? 'timed_out' : 'denied',
          approval: decision,
          result: decision === 'expired'
            ? 'The approval request expired without a decision. The tool was not called.'
            : 'The user denied this tool call. Do not try it again.',
          truncated: false,
        });
        continue;
      }

      emit({ kind: 'call_started', callId: call.callId, name: call.name });
      let execution: ToolExecutionResult;
      try {
        execution = await options.execute(tool, call.callId, parsed.value, options.signal);
      } catch (error) {
        if (options.signal.aborted || isAbort(error)) {
          record({ ...base, status: 'cancelled', approval: 'approved', result: 'The user stopped this turn.', truncated: false });
          closeRemaining('cancelled', 'not_requested', 'The user stopped this turn.', 1);
          return { content, calls, rounds, usage, aborted: true, stop, transcript };
        }
        execution = { ok: false, error: error instanceof Error ? error.message : 'The tool call failed.' };
      }
      if (options.signal.aborted) {
        record({ ...base, status: 'cancelled', approval: 'approved', result: 'The user stopped this turn.', truncated: false });
        closeRemaining('cancelled', 'not_requested', 'The user stopped this turn.', 1);
        return { content, calls, rounds, usage, aborted: true, stop, transcript };
      }

      const bounded = execution.ok
        ? truncate(execution.content, limits.maxResultBytes)
        : { text: execution.error, truncated: false };
      record({
        ...base,
        status: execution.ok ? 'completed' : 'failed',
        approval: 'approved',
        result: bounded.text,
        truncated: bounded.truncated,
        error: execution.ok ? undefined : execution.error,
      });
    }

    // OpenRouter requires an answer for every call id it was given.
    for (const dropped of overflowed) {
      record({
        callId: dropped.callId, name: dropped.name, connectionId: '', toolId: '',
        arguments: dropped.arguments, status: 'too_large', approval: 'not_requested',
        result: `Only ${limits.maxCallsPerRound} tool calls run per round. This one was skipped.`,
        truncated: false,
      });
    }

    if (stop?.limit === 'calls') break;
  }

  if (!stop) {
    stop = { limit: 'rounds', message: `The turn reached its limit of ${limits.maxRounds} tool rounds.` };
  }
  emit({ kind: 'stopped', stop });

  // The budget is spent: give the model one last, tool-free chance to answer.
  const closing = await streamChat(messages, options.model, {
    thinkingLevel: options.thinkingLevel,
    signal: options.signal,
    onChunk: options.onChunk,
    onReasoning: options.onReasoning,
    trace: options.trace ? { ...options.trace, span: `${options.trace.span ?? 'completion'}:closing` } : undefined,
  }).catch((error) => {
    if (isAbort(error) || options.signal.aborted) return undefined;
    throw error;
  });
  if (closing) {
    usage.input += closing.usage.promptTokens;
    usage.output += closing.usage.completionTokens;
    if (closing.content) content = content ? `${content}\n\n${closing.content}` : closing.content;
  }

  return { content, calls, rounds, usage, aborted: options.signal.aborted, stop, transcript };
}

/** Tokens a set of tool schemas costs the prompt, for the budget check upstream. */
export function toolSchemaTokens(tools: readonly LoopTool[]): number {
  return tools.reduce(
    (total, tool) => total + countTokens(`${tool.name} ${tool.description ?? ''} ${JSON.stringify(tool.parameters ?? {})}`),
    0
  );
}
