import { describe, expect, it } from 'vitest';
import { estimateCostUsd, estimateTokens, pricingFor } from '@/src/lib/observability/cost';
import { CHAT_MODELS } from '@/src/config/models';

describe('estimateTokens', () => {
  it('counts nothing for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('is roughly the tokenizer count and grows with the text', () => {
    const short = estimateTokens('Explain TCP congestion control');
    const long = estimateTokens('Explain TCP congestion control. '.repeat(50));
    expect(short).toBeGreaterThan(3);
    expect(long).toBeGreaterThan(short * 20);
  });
});

describe('estimateCostUsd', () => {
  const sol = CHAT_MODELS.find((model) => model.id === 'openai/gpt-6.1-sol')!;

  it('multiplies the configured per-token prices', () => {
    expect(estimateCostUsd('openai/gpt-6.1-sol', 1000, 500)).toBeCloseTo(
      1000 * sol.pricing.prompt + 500 * sol.pricing.completion,
      10
    );
  });

  it('is zero for an empty call', () => {
    expect(estimateCostUsd('google/gemini-4-argon', 0, 0)).toBe(0);
  });

  it('stays silent about models it has no price for', () => {
    expect(pricingFor('openai/gpt-4o')).toBeUndefined();
    expect(estimateCostUsd('openai/gpt-4o', 100, 100)).toBeUndefined();
    expect(estimateCostUsd('openai/text-embedding-3-small', 100, 0)).toBeUndefined();
  });

  it('stays silent when a token count is missing', () => {
    expect(estimateCostUsd('openai/gpt-6.1-sol', undefined, 10)).toBeUndefined();
    expect(estimateCostUsd('openai/gpt-6.1-sol', 10, undefined)).toBeUndefined();
  });

  it('rounds to a sane number of decimals', () => {
    const cost = estimateCostUsd('anthropic/claude-sonnet-5.5', 333, 777)!;
    expect(cost.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(8);
  });
});
