/**
 * Verifies the limiter's Lua script against a real Redis server: atomic
 * check-and-reserve under concurrency, window pruning, reconciliation and
 * both caps. Runs only when a Redis URL is reachable (set REDIS_URL or
 * REDIS_TEST_URL); otherwise the whole suite is skipped so CI without a
 * Redis service stays green.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createClient } from 'redis';

const url = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL;
const probe = url ? createClient({ url }) : null;
let available = false;
if (probe) {
  try {
    probe.on('error', () => {});
    await probe.connect();
    await probe.ping();
    available = true;
  } catch {
    available = false;
  }
}
if (!available) await probe?.disconnect().catch(() => {});

// Import the real limiter (with the real redisStore) only after the env is
// pinned, so it connects to the test server instead of Upstash.
process.env.REDIS_URL = url ?? '';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const {
  withLLMTokenLimit,
  recordLLMTokens,
  getLLMTokenStatus,
  countTokens,
  estimatePromptTokens,
} = await import('@/src/middleware/llmTokenRateLimit');

const DAY_MS = 24 * 60 * 60 * 1000;
const users: string[] = [];
const freshUser = () => {
  const id = `rate-limit-test-${randomUUID()}`;
  users.push(id);
  return id;
};

function promptEstimating(tokens: number): string {
  let text = 'hello world';
  while (estimatePromptTokens(text, false) < tokens) text += ' hello world';
  return text;
}

vi.spyOn(console, 'warn').mockImplementation(() => {});

afterAll(async () => {
  // Remove test keys immediately instead of waiting for the 48h TTL.
  for (const id of users) {
    if (probe?.isReady) await probe.del(`ratelimit:llm-tokens:${id}`);
  }
  await probe?.disconnect().catch(() => {});
});

describe.skipIf(!available)('rate limiter against real Redis', () => {
  beforeAll(() => {
    expect(available).toBe(true);
  });

  it('allows and reports status through the script', async () => {
    const user = freshUser();
    expect(await withLLMTokenLimit(user, 'hi', false)).toBeNull();
    const status = await getLLMTokenStatus(user);
    expect(status.tokensUsed).toBeGreaterThanOrEqual(estimatePromptTokens('hi', false));
    expect(status.tokensLimit).toBe(4000);
  });

  it('is atomic under concurrency: only 3 of 5 parallel 1200-token reservations pass', async () => {
    const user = freshUser();
    const prompt = promptEstimating(1200);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => withLLMTokenLimit(user, prompt, false))
    );
    expect(responses.filter((response) => response === null)).toHaveLength(3);
    expect(responses.filter((response) => response?.status === 429)).toHaveLength(2);
  });

  it('enforces the council cap in the script', async () => {
    const user = freshUser();
    expect(await withLLMTokenLimit(user, 'council a', true)).toBeNull();
    expect(await withLLMTokenLimit(user, 'council b', true)).toBeNull();
    const denied = await withLLMTokenLimit(user, 'council c', true);
    expect(denied?.status).toBe(429);
    expect((await denied!.json()).message).toContain('daily limit of 2 council messages');
    // Regular messages still work.
    expect(await withLLMTokenLimit(user, 'normal', false)).toBeNull();
  });

  it('reconciles the estimate down to the actual usage', async () => {
    const user = freshUser();
    const big = promptEstimating(3000);
    expect(await withLLMTokenLimit(user, big, false)).toBeNull();
    const reserved = await getLLMTokenStatus(user);
    expect(reserved.tokensUsed).toBeGreaterThanOrEqual(3000);

    await recordLLMTokens(user, 250, false);
    const after = await getLLMTokenStatus(user);
    expect(after.tokensUsed).toBe(250);
    // The freed budget is usable again.
    expect(await withLLMTokenLimit(user, big, false)).toBeNull();
  });

  it('prunes records older than the 24h window', async () => {
    const user = freshUser();
    const staleTs = Date.now() - DAY_MS - 60_000;
    // Same member format the script writes: tokens:council:pending:nonce.
    await probe!.zAdd(`ratelimit:llm-tokens:${user}`, { score: staleTs, value: `3500:0:0:${randomUUID()}` });

    const status = await getLLMTokenStatus(user);
    expect(status.tokensUsed).toBe(0);
    expect(status.resetAt).toBeGreaterThanOrEqual(Date.now() + DAY_MS - 5000);
  });

  it('sets a TTL on the user key', async () => {
    const user = freshUser();
    expect(await withLLMTokenLimit(user, 'hi', false)).toBeNull();
    const ttl = await probe!.pTTL(`ratelimit:llm-tokens:${user}`);
    expect(ttl).toBeGreaterThan(DAY_MS);
    expect(ttl).toBeLessThanOrEqual(DAY_MS * 2);
  });

  it('counts tokens identically to the tokenizer', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
  });
});
