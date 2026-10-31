import { formatMessagesWithSystemContext } from '@/src/services/prompt/promptService';
import {
  effectiveThinkingLevel,
  modelSupportsReasoning,
  type ThinkingLevel,
} from '@/src/config/models';
import {
  promptText,
  traceLlmCall,
  type LlmCallMetrics,
  type LlmTraceContext,
} from '@/src/lib/observability/trace-llm-call';
import type { OpenRouterPart } from './attachments';
import type { ParsedSkill } from '@/src/lib/skills/skill-file';
import { outputTokenCap } from './prompt-budget';
import { ToolCallAccumulator, type RawToolCallDelta, type StreamedToolCall } from './tool-stream';

/** An assistant message asking for tool calls, as OpenRouter expects it. */
export interface OutgoingToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage = {
  role: string;
  content: string | OpenRouterPart[] | null;
  tool_calls?: OutgoingToolCall[];
  tool_call_id?: string;
};

/** A tool the model may call, already normalized to an OpenRouter-safe name. */
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: unknown };
}

/** The structured result of one streamed model response. */
export interface StreamedTurn {
  content: string;
  /** Complete calls only; arguments are never parsed here. */
  toolCalls: StreamedToolCall[];
  finishReason?: string;
  usage: { promptTokens: number; completionTokens: number };
  /** True when the user stopped or disconnected before the stream ended. */
  aborted: boolean;
  /** True when the answer ended with tool calls instead of text. */
  wantsTools: boolean;
}

/** Everything except the model and the signal, which the call already knows. */
export type StreamTrace = Omit<LlmTraceContext, 'model' | 'signal'>;

export interface StreamOptions {
  thinkingLevel?: ThinkingLevel;
  onChunk?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  /** Cancels the upstream request (the user stopped or disconnected). */
  signal?: AbortSignal;
  /** When set, this call is recorded to OpenObserve. No-op when it is unset. */
  trace?: StreamTrace;
  /** Tool definitions for this call. Sending them is what enables tool calls. */
  tools?: ToolDefinition[];
}

// Reasoning tokens count against max_tokens, so higher effort needs more room
// or the visible answer gets cut off. The cap table lives in prompt-budget so
// the context budget and the request agree.
// OpenRouter's name for "no reasoning" is the effort 'none'.
function reasoningParam(level: ThinkingLevel) {
  return { effort: level === 'off' ? 'none' : level };
}

// Never ask a model for more output than its provider allows, or OpenRouter
// rejects the whole request.
function maxTokensFor(model: string, level: ThinkingLevel): number {
  return outputTokenCap(model, level);
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

const idleMetrics: LlmCallMetrics = {
  firstToken: () => {},
  usage: () => {},
  finishReason: () => {},
  completion: () => {},
};

async function runStream(
  messages: ChatMessage[],
  model: string,
  { thinkingLevel = 'off', onChunk, onReasoning, signal, tools }: StreamOptions,
  metrics: LlmCallMetrics
): Promise<StreamedTurn> {
  // Clamp to what this model supports; e.g. Gemini has no Off and no Max.
  const level = effectiveThinkingLevel(model, thinkingLevel);
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'ChatterStack',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: maxTokensFor(model, level),
      // Non-reasoning models (GPT-4.1, Llama, Kimi K2, …) reject or ignore a
      // reasoning request, so only send it when the model actually reasons.
      ...(modelSupportsReasoning(model) ? { reasoning: reasoningParam(level) } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenRouter API error: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body');
  }

  let fullContent = '';
  let pending = '';
  let finishReason: string | undefined;
  const toolCalls = new ToolCallAccumulator();
  const usage = { promptTokens: 0, completionTokens: 0 };

  const turn = (aborted: boolean): StreamedTurn => {
    const calls = toolCalls.list();
    metrics.completion(fullContent);
    // A call that asked for tools answered even though it streamed no text.
    if (fullContent || calls.length > 0 || aborted || signal?.aborted) {
      return { content: fullContent, toolCalls: calls, finishReason, usage, aborted, wantsTools: calls.length > 0 };
    }
    throw new Error(
      finishReason === 'length'
        ? 'The model ran out of tokens while thinking and gave no answer. Try a lower thinking level.'
        : `The model returned no answer${finishReason ? ` (${finishReason})` : ''}. Try again or pick another model.`
    );
  };

  const handleLine = (line: string): boolean => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    if (!data) return false;

    const parsed = JSON.parse(data);
    if (parsed.error) {
      throw new Error(parsed.error.message || 'OpenRouter stream error');
    }
    if (parsed.usage) {
      usage.promptTokens = parsed.usage.prompt_tokens ?? usage.promptTokens;
      usage.completionTokens = parsed.usage.completion_tokens ?? usage.completionTokens;
      metrics.usage(parsed.usage);
    }
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
      metrics.finishReason(choice.finish_reason);
    }
    const delta = choice?.delta;
    if (typeof delta?.reasoning === 'string' && delta.reasoning) {
      metrics.firstToken();
      onReasoning?.(delta.reasoning);
    }
    if (typeof delta?.content === 'string' && delta.content) {
      metrics.firstToken();
      fullContent += delta.content;
      onChunk?.(delta.content);
    }
    toolCalls.push(delta?.tool_calls as RawToolCallDelta[] | undefined);
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (handleLine(line)) return turn(false);
      }
    }
  } catch (error) {
    if (isAbort(error)) return turn(true);
    throw error;
  }

  pending += decoder.decode();
  if (pending && handleLine(pending)) return turn(false);

  return turn(false);
}

function traceContext(
  trace: StreamTrace,
  model: string,
  signal: AbortSignal | undefined,
  messages: ChatMessage[]
): LlmTraceContext {
  return {
    ...trace,
    model,
    signal,
    prompt: trace.prompt ?? promptText(messages),
    messageCount: trace.messageCount ?? messages.length,
  };
}

/**
 * Streams a completion from OpenRouter without adding any system context.
 * Returns the full answer text (reasoning is reported only via onReasoning).
 * If `signal` aborts mid-stream, the upstream request is cancelled and the
 * text received so far is returned.
 */
export async function streamCompletion(
  messages: ChatMessage[],
  model: string,
  options: StreamOptions = {}
): Promise<string> {
  const streamed = await streamTurn(messages, model, options);
  return streamed.content;
}

/**
 * The structured form of `streamCompletion`: the answer text, the complete
 * tool calls (arguments are accumulated but never parsed here), the provider
 * usage and whether the call was aborted. Tool definitions are only sent when
 * `options.tools` is non-empty, so a call without tools behaves exactly as
 * before.
 */
export async function streamTurn(
  messages: ChatMessage[],
  model: string,
  options: StreamOptions = {}
): Promise<StreamedTurn> {
  if (!options.trace) return runStream(messages, model, options, idleMetrics);

  return traceLlmCall(traceContext(options.trace, model, options.signal, messages), (metrics) =>
    runStream(messages, model, options, metrics)
  );
}

export async function createCompletion(
  messages: ChatMessage[],
  model: string,
  { skills, ...options }: StreamOptions & { skills?: readonly ParsedSkill[] } = {}
): Promise<string> {
  const formatted = await streamChat(messages, model, { skills, ...options });
  return formatted.content;
}

/** `createCompletion` with system context applied and the structured result. */
export async function streamChat(
  messages: ChatMessage[],
  model: string,
  { skills, ...options }: StreamOptions & { skills?: readonly ParsedSkill[] } = {}
): Promise<StreamedTurn> {
  const formatted = formatMessagesWithSystemContext(
    messages as Array<{ role: string; content: string | OpenRouterPart[] }>,
    model,
    skills
  ) as ChatMessage[];
  if (!options.trace) return runStream(formatted, model, options, idleMetrics);

  return traceLlmCall(traceContext(options.trace, model, options.signal, formatted), (metrics) =>
    runStream(formatted, model, options, metrics)
  );
}
