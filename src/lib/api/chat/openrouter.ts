import { formatMessagesWithSystemContext } from '@/src/services/prompt/promptService';
import { effectiveThinkingLevel, type ThinkingLevel } from '@/src/config/models';
import type { OpenRouterPart } from './attachments';
import type { ParsedSkill } from '@/src/lib/skills/skill-file';

type ChatMessage = { role: string; content: string | OpenRouterPart[] };

export interface StreamOptions {
  thinkingLevel?: ThinkingLevel;
  onChunk?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  /** Cancels the upstream request (the user stopped or disconnected). */
  signal?: AbortSignal;
}

// Reasoning tokens count against max_tokens, so higher effort needs more room
// or the visible answer gets cut off.
const MAX_TOKENS: Record<ThinkingLevel, number> = {
  off: 4000,
  low: 8000,
  medium: 12000,
  high: 20000,
  xhigh: 32000,
  max: 64000,
};

// OpenRouter's name for "no reasoning" is the effort 'none'.
function reasoningParam(level: ThinkingLevel) {
  return { effort: level === 'off' ? 'none' : level };
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/**
 * Streams a completion from OpenRouter without adding any system context.
 * Returns the full answer text (reasoning is reported only via onReasoning).
 * If `signal` aborts mid-stream, the upstream request is cancelled and the
 * text received so far is returned.
 */
export async function streamCompletion(
  messages: ChatMessage[],
  model: string,
  { thinkingLevel = 'off', onChunk, onReasoning, signal }: StreamOptions = {}
): Promise<string> {
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
      max_tokens: MAX_TOKENS[level],
      reasoning: reasoningParam(level),
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

  // A stream that ends normally without any answer text (for example, the
  // model spent its whole token budget thinking) must not look like success.
  const finish = () => {
    // Stop before any text is not a failure.
    if (fullContent || signal?.aborted) return fullContent;
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
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    if (typeof delta?.reasoning === 'string' && delta.reasoning) {
      onReasoning?.(delta.reasoning);
    }
    if (typeof delta?.content === 'string' && delta.content) {
      fullContent += delta.content;
      onChunk?.(delta.content);
    }
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
        if (handleLine(line)) return finish();
      }
    }
  } catch (error) {
    if (isAbort(error)) return fullContent;
    throw error;
  }

  pending += decoder.decode();
  if (pending && handleLine(pending)) return finish();

  return finish();
}

export async function createCompletion(
  messages: ChatMessage[],
  model: string,
  { skills, ...options }: StreamOptions & { skills?: readonly ParsedSkill[] } = {}
): Promise<string> {
  return streamCompletion(formatMessagesWithSystemContext(messages, model, skills), model, options);
}
