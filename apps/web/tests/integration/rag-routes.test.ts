/**
 * Integration tests for the hardening of the RAG / profile routes:
 * authentication, zod validation, conversation ownership for ingestion,
 * per-user rate limits (429 + Retry-After) and the happy paths.
 * Only the edges (auth, Prisma, embedding/retrieval/profile services) are
 * faked; the real routes and the real request limiter run. Without a Redis
 * env the limiter exercises its in-memory fallback, which is exactly the
 * development/test behavior under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';

const auth = vi.fn();
const OWNED_CHAT = '11111111-1111-4111-8111-111111111111';
const OWNED_MESSAGE = '22222222-2222-4222-8222-222222222222';
const OTHERS_CHAT = '33333333-3333-4333-8333-333333333333';

// Each test gets a fresh user id so Redis-backed counters cannot leak
// between tests when a Redis server happens to be reachable.
let currentUserId = randomUUID();

const prismaMock = {
  conversation: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === OWNED_CHAT && where.userId === currentUserId ? { id: where.id } : null
    ),
  },
  message: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; conversationId: string } }) =>
      where.id === OWNED_MESSAGE && where.conversationId === OWNED_CHAT ? { id: where.id } : null
    ),
  },
};

const ingestMessage = vi.fn<(params: unknown) => Promise<void>>(async () => {});
const retrieveContextWithFallback = vi.fn<(params: unknown) => Promise<unknown[]>>(async () => []);
const inferUserProfile = vi.fn<(userId: string) => Promise<void>>(async () => {});
const getUserProfile = vi.fn();
const saveUserProfile = vi.fn<(profile: unknown) => Promise<void>>(async () => {});

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/src/services/rag/ingest', () => ({ ingestMessage: (params: unknown) => ingestMessage(params) }));
vi.mock('@/src/services/rag/retrievalService', () => ({
  retrieveContextWithFallback: (params: unknown) => retrieveContextWithFallback(params),
  formatContextForLLM: (context: unknown) => (Array.isArray(context) && context.length > 0 ? 'formatted context' : ''),
}));
vi.mock('@/src/services/profile/profiler', () => ({ inferUserProfile: (userId: string) => inferUserProfile(userId) }));
vi.mock('@/src/services/profile/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/profile/storage')>()),
  getUserProfile: (userId: string) => getUserProfile(userId),
  saveUserProfile: (profile: unknown) => saveUserProfile(profile),
}));

const { POST: ingest } = await import('@/src/app/api/rag/ingest/route');
const { POST: retrieve } = await import('@/src/app/api/rag/retrieve/route');
const { POST: refresh } = await import('@/src/app/api/rag/profile/refresh/route');
const { PUT: updateProfile } = await import('@/src/app/api/rag/profile/[userId]/route');
const { __resetRequestLimitCountersForTests } = await import('@/src/middleware/requestRateLimit');

function post(handler: (request: NextRequest) => Promise<Response>, body?: unknown) {
  return handler(
    new Request('http://localhost/api/rag', body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest
  );
}

const putProfile = (userId: string, body: unknown) =>
  updateProfile(
    new Request('http://localhost/api/rag/profile/' + userId, { method: 'PUT', body: JSON.stringify(body) }) as unknown as NextRequest,
    { params: Promise.resolve({ userId }) }
  );

const validIngest = () => ({
  conversationId: OWNED_CHAT,
  messageId: OWNED_MESSAGE,
  content: 'Slow start doubles the congestion window.',
  role: 'user',
});

beforeEach(() => {
  currentUserId = randomUUID();
  auth.mockReset().mockResolvedValue({ user: { id: currentUserId } });
  ingestMessage.mockClear();
  retrieveContextWithFallback.mockClear();
  inferUserProfile.mockClear();
  getUserProfile.mockReset();
  saveUserProfile.mockClear();
  prismaMock.conversation.findFirst.mockClear();
  prismaMock.message.findFirst.mockClear();
  __resetRequestLimitCountersForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/rag/ingest', () => {
  it('rejects signed-out requests', async () => {
    auth.mockResolvedValue(null);
    expect((await post(ingest, validIngest())).status).toBe(401);
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies', async () => {
    for (const body of [
      null,
      {},
      { ...validIngest(), conversationId: 'not-a-uuid' },
      { ...validIngest(), role: 'system' },
      { ...validIngest(), content: '   ' },
      { ...validIngest(), content: 'x'.repeat(200_001) },
      { ...validIngest(), timestamp: 'yesterday' },
    ]) {
      const response = await post(ingest, body);
      expect(response.status, JSON.stringify(body)?.slice(0, 80) ?? 'null').toBe(400);
    }
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it("refuses a conversation that doesn't belong to the user", async () => {
    const response = await post(ingest, { ...validIngest(), conversationId: OTHERS_CHAT });
    expect(response.status).toBe(404);
    expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: OTHERS_CHAT, userId: currentUserId },
      select: { id: true },
    });
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it('refuses a messageId from another conversation', async () => {
    const response = await post(ingest, { ...validIngest(), messageId: randomUUID() });
    expect(response.status).toBe(400);
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it('ingests a verified message of the user with a parsed timestamp', async () => {
    const stamp = '2026-05-01T12:00:00.000Z';
    const response = await post(ingest, { ...validIngest(), timestamp: stamp, modelUsed: 'openai/gpt-6.1-sol' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(ingestMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: currentUserId,
        conversationId: OWNED_CHAT,
        messageId: OWNED_MESSAGE,
        role: 'user',
        modelUsed: 'openai/gpt-6.1-sol',
        timestamp: new Date(stamp),
      })
    );
  });

  it('returns 429 with Retry-After once the per-minute cap is hit', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 30; i++) last = await post(ingest, validIngest());
    expect(last?.status).toBe(200);
    const denied = await post(ingest, validIngest());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await denied.json()).error).toBe('Rate limit exceeded');
    expect(ingestMessage).toHaveBeenCalledTimes(30);
  });
});

describe('POST /api/rag/retrieve', () => {
  it('rejects signed-out requests', async () => {
    auth.mockResolvedValue(null);
    expect((await post(retrieve, { query: 'anything' })).status).toBe(401);
  });

  it('rejects missing, oversized or malformed queries', async () => {
    for (const body of [
      {},
      { query: '   ' },
      { query: 'x'.repeat(8001) },
      { query: 'ok', shortTermMessages: Array.from({ length: 51 }, () => ({ role: 'user', content: 'x' })) },
      { query: 'ok', shortTermMessages: [{ role: 'wizard', content: 'x' }] },
      { query: 'ok', currentConversationId: 'nope' },
      { query: 'ok', timeWindowDays: 0 },
    ]) {
      expect((await post(retrieve, body)).status).toBe(400);
    }
    expect(retrieveContextWithFallback).not.toHaveBeenCalled();
  });

  it('retrieves with validated params', async () => {
    const response = await post(retrieve, {
      query: 'What did we decide about cwnd?',
      currentConversationId: OWNED_CHAT,
      shortTermMessages: [{ role: 'user', content: 'TCP notes' }],
      timeWindowDays: 30,
    });
    expect(response.status).toBe(200);
    expect(await retrieveContextWithFallback.mock.results[0]?.value).toEqual([]);
    expect(await response.json()).toMatchObject({ success: true, formatted: '' });
  });

  it('rate limits per user', async () => {
    for (let i = 0; i < 30; i++) expect((await post(retrieve, { query: 'q' + i })).status).toBe(200);
    const denied = await post(retrieve, { query: 'one too many' });
    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).not.toBeNull();
  });
});

describe('POST /api/rag/profile/refresh', () => {
  it('rejects signed-out requests', async () => {
    auth.mockResolvedValue(null);
    expect((await post(refresh)).status).toBe(401);
  });

  it('triggers inference and caps refresh bursts', async () => {
    for (let i = 0; i < 5; i++) expect((await post(refresh)).status).toBe(200);
    expect(inferUserProfile).toHaveBeenCalledTimes(5);
    const denied = await post(refresh);
    expect(denied.status).toBe(429);
    expect(inferUserProfile).toHaveBeenCalledTimes(5);
  });
});

describe('PUT /api/rag/profile/[userId]', () => {
  it('rejects unknown styles and oversized preference lists', async () => {
    expect((await putProfile(currentUserId, { explanationStyle: 'vibes' })).status).toBe(400);
    expect((await putProfile(currentUserId, { technicalLevel: 'wizard' })).status).toBe(400);
    expect((await putProfile(currentUserId, { preferences: { likes: Array.from({ length: 101 }, (_, i) => `l${i}`) } })).status).toBe(400);
    expect(saveUserProfile).not.toHaveBeenCalled();
  });

  it('accepts a valid partial update', async () => {
    getUserProfile.mockResolvedValue({
      userId: currentUserId, technicalLevel: 'intermediate', explanationStyle: 'detailed',
      topicFrequency: {}, preferences: { likes: [], dislikes: [] }, messageCount: 3, lastUpdated: new Date(), version: 1,
    });
    const response = await putProfile(currentUserId, { technicalLevel: 'expert', preferences: { likes: ['Rust'] } });
    expect(response.status).toBe(200);
    expect(saveUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ technicalLevel: 'expert', preferences: expect.objectContaining({ likes: ['Rust'] }) })
    );
  });
});
