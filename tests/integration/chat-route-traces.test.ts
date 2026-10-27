/**
 * POST /api/chat and its OpenObserve root span: every request gets one -
 * including the ones refused before streaming - and its status matches what
 * actually happened to the turn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { delta, readEvents, sseResponse } from '../helpers/sse';

const auth = vi.fn();
const OTHER_USERS_CHAT = '9f1c2d3e-0000-4000-8000-000000000000';
const NEW_ID = '0e7ba32e-05b0-477d-8e30-2bf0a849649e';

const conversationRows = {
  create: vi.fn(async ({ data }: { data: { id: string } }) => ({ ...data, title: null })),
  updateMany: vi.fn(async () => ({ count: 1 })),
  update: vi.fn(async () => ({})),
  findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === OTHER_USERS_CHAT ? null : { id: where.id })),
};

const messageRows = {
  findMany: vi.fn(async () => []),
  createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
  aggregate: vi.fn(async () => ({ _max: { position: null } })),
  count: vi.fn(async () => 0),
};

const db = {
  document: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  conversation: conversationRows,
  message: messageRows,
  $transaction: vi.fn(async (work: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
    typeof work === 'function' ? work({ conversation: conversationRows, message: messageRows }) : Promise.all(work)),
};

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
vi.mock('@/src/lib/server/document-storage', () => ({ documentStorage: { read: vi.fn() } }));
vi.mock('@/src/lib/redis', () => ({ redisStore: { get: vi.fn(async () => []), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) } }));
vi.mock('@/src/lib/api/chat/rag-integration', () => ({
  retrieveRAGContext: vi.fn(async () => ''),
  ingestConversationData: vi.fn(async () => {}),
}));
const withLLMTokenLimit = vi.fn<() => Promise<Response | null>>(async () => null);
vi.mock('@/src/middleware/llmTokenRateLimit', () => ({
  withLLMTokenLimit: () => withLLMTokenLimit(),
  recordLLMTokens: vi.fn(async () => {}),
  countTokens: (text: string) => text.length,
  estimatePromptTokens: (text: string) => text.length,
}));

type RootSpan = { traceId: string; status: string; httpStatus?: number; error?: unknown; userId?: string; model?: string; answer?: string };
const rootSpans: RootSpan[] = [];
vi.mock('@/src/lib/observability/otlp-traces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/observability/otlp-traces')>()),
  recordRequestSpan: (input: RootSpan) => { rootSpans.push(input); },
}));

const { POST } = await import('@/src/app/api/chat/route');

const fetchMock = vi.fn();
const post = (body: string | object) =>
  POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest);

beforeEach(() => {
  rootSpans.length = 0;
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchMock);
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  withLLMTokenLimit.mockReset().mockResolvedValue(null);
  db.message.createMany.mockReset().mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  fetchMock.mockReset().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.model === 'openai/gpt-5.6-luna') {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'A title' } }] }));
    }
    return sseResponse([delta({ content: 'An answer.' }), '[DONE]']);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/chat traces: requests refused before streaming', () => {
  it.each([
    ['signed out', async () => { auth.mockResolvedValue(null); return post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol' }); }, 401],
    ['invalid input', () => post({ message: 'hi', selectedModel: 'evil/model' }), 400],
    ["someone else's conversation", () => post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', conversationId: OTHER_USERS_CHAT }), 404],
    ['rate limited', async () => {
      withLLMTokenLimit.mockResolvedValue(new Response('{}', { status: 429 }));
      return post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol' });
    }, 429],
  ])('%s: answers %i and records a rejected root span', async (_label, send, status) => {
    const response = await send();
    expect(response.status).toBe(status);
    expect(rootSpans).toHaveLength(1);
    expect(rootSpans[0]).toMatchObject({ status: 'rejected', httpStatus: status });
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const response = await post('{not json');
    expect(response.status).toBe(400);
    expect(rootSpans[0]).toMatchObject({ status: 'rejected', httpStatus: 400, userId: 'user-1' });
  });

  it('records a limiter outage (503) as an error', async () => {
    withLLMTokenLimit.mockResolvedValue(new Response('{}', { status: 503 }));
    const response = await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol' });
    expect(response.status).toBe(503);
    expect(rootSpans[0]).toMatchObject({ status: 'error', httpStatus: 503 });
  });
});

describe('POST /api/chat traces: streamed turns', () => {
  it('records a finished turn as ok, with the answer', async () => {
    await readEvents(await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true }));
    expect(rootSpans).toHaveLength(1);
    expect(rootSpans[0]).toMatchObject({ status: 'ok', model: 'openai/gpt-6.1-sol', answer: 'An answer.' });
  });

  it('records the turn as an error when saving fails after the model answered', async () => {
    db.message.createMany.mockRejectedValue(new Error('database is down'));
    await readEvents(await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true }));
    expect(rootSpans).toHaveLength(1);
    expect(rootSpans[0].status).toBe('error');
    expect((rootSpans[0].error as Error).message).toBe('database is down');
  });
});
