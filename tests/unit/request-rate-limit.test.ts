/**
 * Unit tests for the shared per-user request limiter used by the RAG and
 * profile routes: cap boundary, Retry-After on 429, fail-closed in
 * production when Redis is unavailable, and atomic counting via the script.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const evalScript = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/redis', () => ({
  redisStore: { evalScript: (...args: Parameters<typeof evalScript>) => evalScript(...args) },
}));

const { withUserRateLimits, __resetRequestLimitCountersForTests } = await import('@/src/middleware/requestRateLimit');
import type { RouteLimit } from '@/src/middleware/requestRateLimit';

const LIMIT: RouteLimit = { name: 'test-limit', max: 3, windowMs: 60_000 };
const USER = 'limiter-user';

beforeEach(() => {
  __resetRequestLimitCountersForTests();
  evalScript.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('redis backend', () => {
  it('allows up to the cap and answers 429 with Retry-After after it', async () => {
    evalScript.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    expect(await withUserRateLimits(USER, [LIMIT])).toBeNull();
    expect(await withUserRateLimits(USER, [LIMIT])).toBeNull();
    expect(await withUserRateLimits(USER, [LIMIT])).toBeNull();
    const denied = await withUserRateLimits(USER, [LIMIT]);
    expect(denied?.status).toBe(429);
    expect(Number(denied!.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(denied!.headers.get('X-RateLimit-Limit')).toBe('3');
    // The script bumps one keyed counter per user/limit/window.
    expect(evalScript.mock.calls[0][1].keys[0]).toContain(`test-limit:60000:${USER}`);
  });

  it('checks every limit of the set', async () => {
    const daily: RouteLimit = { name: 'test-daily', max: 10, windowMs: 86_400_000 };
    evalScript.mockResolvedValue(1);
    expect(await withUserRateLimits(USER, [LIMIT, daily])).toBeNull();
    expect(evalScript).toHaveBeenCalledTimes(2);
  });
});

describe('redis unavailable', () => {
  beforeEach(() => {
    evalScript.mockRejectedValue(new Error('Redis is not available'));
  });

  it('production fails closed with 503', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await withUserRateLimits(USER, [LIMIT]);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: 'Rate limiter unavailable' });
  });

  it('development/test counts in memory and still enforces', async () => {
    expect(await withUserRateLimits(USER, [LIMIT])).toBeNull();
    expect(await withUserRateLimits(USER, [LIMIT])).toBeNull();
    expect(await withUserRateLimits(USER, [LIMIT])).toBeNull();
    expect((await withUserRateLimits(USER, [LIMIT]))?.status).toBe(429);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
