/**
 * LLM token rate limiter unit tests. Redis is stubbed at the module edge:
 * the fallback (development/test) path, the Redis reply handling, and the
 * public 429/503 shapes are covered here. The Lua script itself is verified
 * against a real Redis in llm-token-rate-limit-redis.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const evalScript = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/redis', () => ({
  redisStore: { evalScript: (...args: Parameters<typeof evalScript>) => evalScript(...args) },
}));

const {
  withLLMTokenLimit,
  recordLLMTokens,
  getLLMTokenStatus,
  countTokens,
  estimatePromptTokens,
  __resetMemoryLimiterForTests,
} = await import('@/src/middleware/llmTokenRateLimit');

const USER = 'user-under-test';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Prompt whose estimate (input + ceil(input * 2.5)) is at least `tokens`. */
function promptEstimating(tokens: number): string {
  let text = 'hello world';
  while (estimatePromptTokens(text, false) < tokens) text += ' hello world';
  return text;
}

beforeEach(() => {
  __resetMemoryLimiterForTests();
  evalScript.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('memory fallback (development/test, Redis down)', () => {
  beforeEach(() => {
    evalScript.mockRejectedValue(new Error('Redis is not available'));
  });

  it('warns once and lets the first request through', async () => {
    expect(await withLLMTokenLimit(USER, 'hi', false)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.warn).mock.calls[0][0])).toContain('in-memory');
  });

  it('reserves the estimate so a concurrent second request cannot spend the same budget', async () => {
    const big = promptEstimating(2500);
    const [first, second] = await Promise.all([
      withLLMTokenLimit(USER, big, false),
      withLLMTokenLimit(USER, big, false),
    ]);
    const statuses = [first, second].map((response) => response?.status ?? null);
    expect(statuses.filter((status) => status === null).length).toBe(1);
    expect(statuses.filter((status) => status === 429).length).toBe(1);
  });

  it('rejects with 429 once the 4000-token window is exhausted', async () => {
    expect(await withLLMTokenLimit(USER, promptEstimating(3900), false)).toBeNull();
    const denied = await withLLMTokenLimit(USER, promptEstimating(150), false);
    expect(denied?.status).toBe(429);
    const body = await denied!.json();
    expect(body.error).toBe('Rate limit exceeded');
    expect(body.message).toContain('daily token limit');
    expect(body.details.tokensLimit).toBe(4000);
    expect(denied!.headers.get('Retry-After')).not.toBeNull();
  });

  it('reopens the budget after the 24h window expires', async () => {
    const now = new Date('2026-05-01T12:00:00Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(await withLLMTokenLimit(USER, promptEstimating(3900), false)).toBeNull();
    expect((await withLLMTokenLimit(USER, promptEstimating(150), false))?.status).toBe(429);

    vi.setSystemTime(now + DAY_MS + 60_000);
    expect(await withLLMTokenLimit(USER, 'fresh window', false)).toBeNull();
  });

  it('caps council messages at 2 per window', async () => {
    expect(await withLLMTokenLimit(USER, 'council one', true)).toBeNull();
    expect(await withLLMTokenLimit(USER, 'council two', true)).toBeNull();
    const denied = await withLLMTokenLimit(USER, 'council three', true);
    expect(denied?.status).toBe(429);
    const body = await denied!.json();
    expect(body.message).toContain('daily limit of 2 council messages');
    expect(body.details.councilRemaining).toBe(0);
  });

  it('reconciles the reservation with the actual usage', async () => {
    const big = promptEstimating(3000);
    expect(await withLLMTokenLimit(USER, big, false)).toBeNull();
    // Mid-window the reservation is visible as used budget...
    const mid = await getLLMTokenStatus(USER);
    expect(mid.tokensUsed).toBeGreaterThan(2500);
    // ...but the actual call cost only 120 tokens.
    await recordLLMTokens(USER, 120, false);
    const after = await getLLMTokenStatus(USER);
    expect(after.tokensUsed).toBe(120);
    // A second call can now use the freed budget again.
    expect(await withLLMTokenLimit(USER, big, false)).toBeNull();
  });

  it('records stopped/failed calls even without a reservation', async () => {
    await recordLLMTokens(USER, 77, false);
    const status = await getLLMTokenStatus(USER);
    expect(status.tokensUsed).toBe(77);
  });
});

describe('redis backend (evalScript replies)', () => {
  it('runs an atomic reserve script keyed by user', async () => {
    const now = Date.now();
    evalScript.mockResolvedValue([1, 0, 0, 0, now, -1]);
    expect(await withLLMTokenLimit(USER, 'hi', false)).toBeNull();

    expect(evalScript).toHaveBeenCalledTimes(1);
    const [script, options] = evalScript.mock.calls[0];
    expect(script).toContain('ZREMRANGEBYSCORE');
    expect(options.keys).toEqual([`ratelimit:llm-tokens:${USER}`]);
    expect(options.arguments[0]).toBe('reserve');
    expect(Number(options.arguments[1])).toBeGreaterThanOrEqual(now - 5);
  });

  it('maps a token-cap denial onto the unchanged 429 shape', async () => {
    const now = new Date('2026-05-01T12:00:00Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const oldest = now - 3 * 60 * 60 * 1000;
    const retryAt = now + 60_000;
    evalScript.mockResolvedValue([0, 3900, 0, 1, retryAt, oldest]);

    const denied = await withLLMTokenLimit(USER, 'hi', false);
    expect(denied?.status).toBe(429);
    const body = await denied!.json();
    expect(body.error).toBe('Rate limit exceeded');
    expect(body.message).toContain('daily token limit');
    expect(body.details).toEqual(expect.objectContaining({
      tokensUsed: 3900,
      tokensLimit: 4000,
      tokensRemaining: 100,
      councilUsed: 0,
      councilLimit: 2,
      councilRemaining: 2,
      resetAt: oldest + DAY_MS,
      resetTime: new Date(oldest + DAY_MS).toISOString(),
      retryAfter: 60,
    }));
    expect(denied!.headers.get('X-RateLimit-LLM-Tokens-Limit')).toBe('4000');
    expect(denied!.headers.get('X-RateLimit-Reset')).toBe(String(oldest + DAY_MS));
    expect(denied!.headers.get('Retry-After')).toBe('60');
    // Redis is the store in this path: nothing went to the memory fallback.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('maps a council-cap denial (reason 2) to the council message', async () => {
    const now = Date.now();
    evalScript.mockResolvedValue([0, 500, 2, 2, now + DAY_MS - 1000, now - 1000]);
    const denied = await withLLMTokenLimit(USER, 'council?', true);
    const body = await denied!.json();
    expect(body.message).toContain('daily limit of 2 council messages');
    expect(denied!.headers.get('X-RateLimit-Council-Remaining')).toBe('0');
  });

  it('reconciles via the reconcile op with the actual token count', async () => {
    evalScript.mockResolvedValue([1, 0, 0, 0, 0, 0]);
    await recordLLMTokens(USER, 321, true);
    expect(evalScript.mock.calls[0][1].arguments[0]).toBe('reconcile');
    expect(Number(evalScript.mock.calls[0][1].arguments[5])).toBe(321);
    expect(Number(evalScript.mock.calls[0][1].arguments[6])).toBe(1);
  });

  it('reads status from the status op', async () => {
    const now = Date.now();
    evalScript.mockResolvedValue([1, 1500, 1, now - DAY_MS / 2, now - DAY_MS / 2]);
    const status = await getLLMTokenStatus(USER);
    expect(evalScript.mock.calls[0][1].arguments[0]).toBe('status');
    expect(status).toMatchObject({
      tokensUsed: 1500,
      tokensLimit: 4000,
      tokensRemaining: 2500,
      councilUsed: 1,
      councilRemaining: 1,
      resetAt: now - DAY_MS / 2 + DAY_MS,
    });
  });
});

describe('fail closed when Redis is down in production', () => {
  beforeEach(() => {
    evalScript.mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('answers 503 instead of allowing uncounted paid calls', async () => {
    const response = await withLLMTokenLimit(USER, 'hi', false);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: 'Rate limiter unavailable' });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('surfaces status failures rather than lying with empty counters', async () => {
    await expect(getLLMTokenStatus(USER)).rejects.toThrow();
  });

  it('rethrows recording failures so the route can log them', async () => {
    await expect(recordLLMTokens(USER, 10, false)).rejects.toThrow();
  });
});

describe('token estimation', () => {
  it('estimates from the full prompt with output allowance (regular 2.5x, council 4x)', () => {
    const text = 'Explain TCP congestion control in detail please';
    const input = countTokens(text);
    expect(estimatePromptTokens(text, false)).toBe(input + Math.ceil(input * 2.5));
    expect(estimatePromptTokens(text, true)).toBe(input + Math.ceil(input * 4));
  });
});
