/**
 * Tests for GET /api/cron/cleanup-documents: bearer-secret handling
 * (constant-time compare), bounded-run reporting and Redis cursor
 * persistence for the resumable blob sweep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cleanupUnusedDocuments = vi.fn<() => Promise<number>>(async () => 2);
const cleanupUnconfirmedUploads = vi.fn<(now: Date, options?: { cursor?: string | null }) => Promise<{ removed: number; hasMore: boolean; cursor: string | null }>>(
  async () => ({ removed: 1, hasMore: false, cursor: null })
);
vi.mock('@/src/lib/server/documents', () => ({
  cleanupUnusedDocuments: () => cleanupUnusedDocuments(),
  cleanupUnconfirmedUploads: (now: Date, options?: { cursor?: string | null }) => cleanupUnconfirmedUploads(now, options),
}));

const redis = { getKey: vi.fn<(key: string) => Promise<string | null>>(async () => null), setKey: vi.fn(async () => {}), deleteKey: vi.fn(async () => false) };
vi.mock('@/src/lib/redis', () => ({ redisStore: redis }));

const { GET } = await import('@/src/app/api/cron/cleanup-documents/route');

const SECRET = 'cron-secret-value-1234567890';

const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/cleanup-documents', authorization ? { headers: { authorization } } : undefined));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  cleanupUnusedDocuments.mockClear();
  cleanupUnconfirmedUploads.mockClear();
  redis.getKey.mockReset().mockResolvedValue(null);
  redis.setKey.mockClear();
  redis.deleteKey.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/cron/cleanup-documents auth', () => {
  it('rejects missing, wrong-shape and wrong-token requests', async () => {
    expect((await call()).status).toBe(401);
    expect((await call(`Token ${SECRET}`)).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
    // A prefix-matching secret must still fail (constant-time, no startsWith).
    expect((await call(`Bearer ${SECRET.slice(0, 5)}`)).status).toBe(401);
    expect((await call('Bearer ')).status).toBe(401);
    expect(cleanupUnconfirmedUploads).not.toHaveBeenCalled();
  });

  it('rejects everything when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call(`Bearer ${''}`)).status).toBe(401);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(401);
  });

  it('accepts the exact bearer token', async () => {
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: 2, orphaned: 1, orphanedHasMore: false });
  });
});

describe('GET /api/cron/cleanup-documents resumable sweep', () => {
  it('resumes from the stored cursor and keeps a full sweep clean', async () => {
    redis.getKey.mockResolvedValueOnce('resume-here');
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(cleanupUnconfirmedUploads).toHaveBeenCalledTimes(1);
    expect(cleanupUnconfirmedUploads.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(cleanupUnconfirmedUploads.mock.calls[0][1]).toEqual({ cursor: 'resume-here' });
    // Completed sweep: the stored cursor is dropped for the next day.
    expect(redis.deleteKey).toHaveBeenCalledWith('cron:cleanup-unconfirmed-uploads:cursor');
    expect(redis.setKey).not.toHaveBeenCalled();
  });

  it('persists the next cursor when the store was not exhausted', async () => {
    cleanupUnconfirmedUploads.mockResolvedValueOnce({ removed: 7, hasMore: true, cursor: 'page-9' });
    const response = await call(`Bearer ${SECRET}`);
    expect(await response.json()).toEqual({ removed: 2, orphaned: 7, orphanedHasMore: true });
    expect(redis.setKey).toHaveBeenCalledWith('cron:cleanup-unconfirmed-uploads:cursor', 'page-9', 48 * 60 * 60);
    expect(redis.deleteKey).not.toHaveBeenCalled();
  });
});
