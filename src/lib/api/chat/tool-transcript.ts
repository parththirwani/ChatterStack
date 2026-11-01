/**
 * The bridge between what a tool turn persisted and what a later model call
 * must see: stored tool calls are replayed in the exact OpenRouter order
 * (assistant tool_calls, then one tool result per call id, then the prose),
 * so a replayed, retried, forked or compacted chat stays valid to continue.
 */
import type { MessageToolCallView } from '@/src/types/chat.types';
import type { ToolLoopCall } from './tool-loop';
import { DEFAULT_TOOL_LOOP_LIMITS } from './tool-loop';
import type { ChatMessage } from './openrouter';
import type { OpenRouterPart } from './attachments';

const MAX_PERSISTED_ERROR_CHARS = 2_048;

const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');

/** Cap raw model text so one hostile round cannot bloat a row or a replay. */
function boundedArguments(raw: string): string {
  const max = DEFAULT_TOOL_LOOP_LIMITS.maxArgumentBytes;
  if (byteLength(raw) <= max) return raw;
  let end = Math.min(raw.length, max);
  let slice = raw.slice(0, end);
  while (byteLength(slice) > max && end > 0) {
    end -= 1;
    slice = raw.slice(0, end);
  }
  return `${slice}\n[truncated]`;
}

/** A finished loop call as it is persisted, streamed and rendered. */
export function loopCallToView(call: ToolLoopCall): MessageToolCallView {
  return {
    callId: call.callId,
    name: call.name,
    toolId: call.toolId,
    connectionId: call.connectionId,
    arguments: boundedArguments(call.arguments),
    status: call.status,
    approval: call.approval,
    result: call.result,
    truncated: call.truncated,
    ...(call.error ? { error: call.error.slice(0, MAX_PERSISTED_ERROR_CHARS) } : {}),
  };
}

/** One model-bound message plus the tool calls an assistant row carries. */
export interface ModelTurnMessage {
  role: 'user' | 'assistant';
  content: string | OpenRouterPart[];
  toolCalls?: readonly MessageToolCallView[];
}

export function asOpenRouterMessages(messages: readonly ModelTurnMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.callId,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const call of message.toolCalls) {
        out.push({ role: 'tool', content: call.result, tool_call_id: call.callId });
      }
    }
    out.push({ role: message.role, content: message.content });
  }
  return out;
}
