import { effectiveThinkingLevel, getModel, type ThinkingLevel } from '@/src/config/models';
import { countTokens } from '@/src/lib/tokens';
import type { OpenRouterPart } from './attachments';

type PromptMessage = { role: string; content: string | OpenRouterPart[] };

/** Reasoning tokens count against `max_tokens`, so higher effort needs more room. */
export const MAX_OUTPUT_TOKENS: Record<ThinkingLevel, number> = {
  off: 4000,
  low: 8000,
  medium: 12000,
  high: 20000,
  xhigh: 32000,
  max: 64000,
};

/** Conservative allowances for media whose provider tokenizer we cannot see. */
const IMAGE_TOKEN_ALLOWANCE = 1600;
const FILE_TOKEN_OVERHEAD = 1000;
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * The output cap actually requested from OpenRouter. Kept here so the budget
 * and the request cannot disagree about how much room the answer needs.
 */
export function outputTokenCap(model: string, level: ThinkingLevel): number {
  const limit = getModel(model)?.maxOutputTokens;
  const cap = MAX_OUTPUT_TOKENS[effectiveThinkingLevel(model, level)];
  return limit ? Math.min(cap, limit) : cap;
}

/** The model's registered context window, with a safe fallback for custom ids. */
export function contextWindow(model: string): number {
  return getModel(model)?.contextLength ?? 128_000;
}

/**
 * How many input tokens this model can take while still leaving room for the
 * requested answer. The margin absorbs tokenizer and provider differences.
 */
export function inputBudgetFor(model: string, level: ThinkingLevel): number {
  const window = contextWindow(model);
  const margin = Math.max(1024, Math.ceil(window * 0.02));
  return Math.max(0, window - outputTokenCap(model, level) - margin);
}

export function contentTokens(content: string | OpenRouterPart[]): number {
  if (typeof content === 'string') return countTokens(content);

  let total = 0;
  for (const part of content) {
    if (part.type === 'text') {
      total += countTokens(part.text);
    } else if (part.type === 'image_url') {
      total += IMAGE_TOKEN_ALLOWANCE;
    } else {
      // Base64 data URL: `file_data` is ~4/3 of the decoded byte length.
      const bytes = Math.ceil((part.file.file_data.length * 3) / 4);
      total += Math.ceil(bytes / 4) + FILE_TOKEN_OVERHEAD;
    }
  }
  return total;
}

/** Tokens in a rendered OpenAI-style message list, including small framing costs. */
export function messagesTokens(messages: readonly PromptMessage[]): number {
  return messages.reduce(
    (total, message) => total + contentTokens(message.content) + MESSAGE_OVERHEAD_TOKENS,
    0
  );
}

/** Thrown when a prompt cannot fit even after compaction. */
export class ContextBudgetError extends Error {
  readonly code = 'context_budget';

  constructor(message: string) {
    super(message);
    this.name = 'ContextBudgetError';
  }
}

/**
 * Last line of defence before an over-limit request. It never truncates the
 * prompt: the user gets an actionable error instead of a provider rejection.
 */
export function assertPromptFits(
  model: string,
  messages: readonly PromptMessage[],
  level: ThinkingLevel,
  label = 'This conversation'
): void {
  const budget = inputBudgetFor(model, level);
  const used = messagesTokens(messages);
  if (used <= budget) return;

  throw new ContextBudgetError(
    `${label} is too large for ${getModel(model)?.name ?? model}'s context window ` +
      `(about ${used.toLocaleString()} input tokens, limit ${budget.toLocaleString()}). ` +
      'Start a new chat, shorten the current message, or choose a model with a larger context window.'
  );
}

/** Cuts text by an approximate character budget (4 characters per token). */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated to fit the model's context window]`;
}
