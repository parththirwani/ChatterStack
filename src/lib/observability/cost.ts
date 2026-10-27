import { encode } from 'gpt-tokenizer';
import { CHAT_MODELS } from '@/src/config/models';

type ModelPricing = { prompt: number; completion: number };

const PRICING = new Map<string, ModelPricing>(
  CHAT_MODELS.map((model) => [model.id as string, model.pricing as ModelPricing])
);

/** Same tokenizer the rate limiter uses, with a cheap fallback for odd input. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function pricingFor(model: string): { prompt: number; completion: number } | undefined {
  return PRICING.get(model);
}

/**
 * USD cost from the prices in `src/config/models.ts`. Models that are not in
 * that list (the title model, the embedding model) have no price here, so the
 * caller records the call without a cost instead of guessing one.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined
): number | undefined {
  const pricing = PRICING.get(model);
  if (!pricing || inputTokens === undefined || outputTokens === undefined) return undefined;
  const cost = inputTokens * pricing.prompt + outputTokens * pricing.completion;
  return Math.round(cost * 1e8) / 1e8;
}
