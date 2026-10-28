/**
 * Integration test for POST /api/chat: the real route, persistence, title
 * service, OpenRouter client and council service run together. Only the edges
 * (auth, Redis, RAG, rate limiting, Prisma and the network) are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { delta, readEvents, sseResponse } from '../helpers/sse';

const log: string[] = [];
const auth = vi.fn();
const OTHER_USERS_CHAT = '9f1c2d3e-0000-4000-8000-000000000000';
const PLAN_ID = '64c8ca0b-82db-41a4-a62d-a2a920a5bb62';
const PDF_ID = 'a36e8a04-5967-43dd-aa7a-cab1497813ee';
const SKILL_ID = '5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a69';
const skillRows = new Map<string, { id: string; userId: string; name: string; description: string; instructions: string; source: string; enabled: boolean; categories: string[]; files: unknown; metadata: unknown; version: number; catalogId: string | null; createdAt: Date; updatedAt: Date }>();
const documentRows = new Map<string, { id: string; userId: string; name: string; mimeType: string; size: number; storageKey: string }>();
const snapshotRows = new Map<string, Record<string, unknown>>();

const conversationRows = {
  create: vi.fn(async ({ data }: { data: { id: string } }) => {
    log.push(`db:create:${data.id}`);
    return { ...data, title: null };
  }),
  updateMany: vi.fn(async ({ data }: { data: { title?: string } }) => {
    log.push(`db:title:${data.title}`);
    return { count: 1 };
  }),
  update: vi.fn(async () => ({})),
  findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === OTHER_USERS_CHAT ? null : { id: where.id })),
};

const messageRows = {
  findMany: vi.fn(async (): Promise<Array<{ role: string; content: string; modelId: string | null }>> => []),
  createMany: vi.fn(async ({ data }: { data: Array<{ role: string; content: string; attachments?: unknown }> }) => {
    log.push(`db:messages:${data.map((m) => `${m.role}=${m.content}`).join('|')}`);
    return { count: data.length };
  }),
  // What a retry removes: the question row and the answer saved after it.
  findFirst: vi.fn(async () => ({ createdAt: new Date('2026-01-01T00:00:00Z') })),
  deleteMany: vi.fn(async () => {
    log.push('db:deleteExchange');
    return { count: 2 };
  }),
  // Where the next exchange's position starts: an empty chat with no rows yet.
  aggregate: vi.fn(async () => ({ _max: { position: null } })),
  count: vi.fn(async () => 0),
};

const db = {
  $queryRaw: vi.fn(async () => [{ id: PLAN_ID }]),
  skill: {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId: string } }) =>
      [...skillRows.values()].filter((row) => row.userId === where.userId && where.id.in.includes(row.id))),
  },
  document: {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId: string } }) =>
      [...documentRows.values()].filter((row) => row.userId === where.userId && where.id.in.includes(row.id))),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  conversation: conversationRows,
  message: messageRows,
  conversationContextSnapshot: {
    findUnique: vi.fn(async ({ where }: { where: { conversationId: string } }) => snapshotRows.get(where.conversationId) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: 'snapshot-1', version: 1, schemaVersion: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
      snapshotRows.set(String(data.conversationId), row);
      log.push('db:snapshot:create');
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { conversationId: string; version: number }; data: Record<string, unknown> }) => {
      const row = snapshotRows.get(where.conversationId);
      if (!row || row.version !== where.version) return { count: 0 };
      Object.assign(row, data);
      log.push('db:snapshot:update');
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { conversationId: string } }) => ({
      count: snapshotRows.delete(where.conversationId) ? 1 : 0,
    })),
  },
  // $transaction takes either a list of operations or a callback that is handed
  // the transactional client; both use the same fakes here.
  $transaction: vi.fn(async (work: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
    typeof work === 'function' ? work({ $queryRaw: db.$queryRaw, conversation: conversationRows, message: messageRows }) : Promise.all(work)),
};

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
const storage = { read: vi.fn(async (key: string) => key.endsWith('plan') ? Buffer.from('# Project plan') : Buffer.from('%PDF-1.7\nexample')) };
vi.mock('@/src/lib/server/document-storage', () => ({ documentStorage: storage }));
const redis = { get: vi.fn<(id: string) => Promise<unknown[]>>(async () => []), set: vi.fn<(id: string, messages: unknown[]) => Promise<void>>(async () => {}), delete: vi.fn(async () => {}) };
vi.mock('@/src/lib/redis', () => ({ redisStore: redis }));
const recordLLMTokens = vi.fn<(user: string, tokens: number, council: boolean) => Promise<void>>(async () => {});
vi.mock('@/src/lib/api/chat/rag-integration', () => ({
  retrieveRAGContext: vi.fn(async () => ''),
  ingestConversationData: vi.fn(async () => {}),
}));
vi.mock('@/src/middleware/llmTokenRateLimit', () => ({
  withLLMTokenLimit: vi.fn(async () => null),
  recordLLMTokens: (user: string, tokens: number, council: boolean) => recordLLMTokens(user, tokens, council),
  countTokens: (text: string) => text.length,
  estimatePromptTokens: (text: string) => text.length,
}));

const { POST } = await import('@/src/app/api/chat/route');

const fetchMock = vi.fn();
const NEW_ID = '0e7ba32e-05b0-477d-8e30-2bf0a849649e';
const openRouterBodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

function post(body: object, signal?: AbortSignal) {
  return POST(
    new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body), signal }) as unknown as NextRequest
  );
}

beforeEach(() => {
  log.length = 0;
  documentRows.clear();
  skillRows.clear();
  snapshotRows.clear();
  storage.read.mockClear();
  db.document.findMany.mockClear();
  db.document.updateMany.mockClear();
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchMock);
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  Object.values(db.conversation).forEach((fn) => fn.mockClear());
  db.message.createMany.mockClear();
  db.message.findMany.mockClear();
  db.message.findFirst.mockClear();
  db.message.deleteMany.mockClear();
  db.message.aggregate.mockClear();
  db.message.count.mockClear();
  redis.get.mockReset().mockImplementation(async () => []);
  redis.set.mockReset().mockImplementation(async () => {});
  redis.delete.mockReset().mockImplementation(async () => {});
  recordLLMTokens.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.model === 'openai/gpt-5.6-luna') {
      log.push('openrouter:title');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'TCP Congestion Control' } }] }));
    }
    log.push(`openrouter:${body.model}`);
    return sseResponse([delta({ reasoning: 'Thinking it over' }), delta({ content: 'Slow start ' }), delta({ content: 'doubles cwnd.' }), '[DONE]']);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/chat, new conversation', () => {
  it('saves the chat and tells the client before the answer starts', async () => {
    const events = await readEvents(
      await post({ message: 'Explain TCP congestion control', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true })
    );

    const createdAt = events.findIndex((e) => e !== '[DONE]' && e.conversationCreated === NEW_ID);
    const firstChunk = events.findIndex((e) => e !== '[DONE]' && 'chunk' in e);
    expect(createdAt).toBeGreaterThan(-1);
    expect(createdAt).toBeLessThan(firstChunk);

    // The row exists before the model is even called.
    expect(log.indexOf(`db:create:${NEW_ID}`)).toBeLessThan(log.indexOf('openrouter:openai/gpt-6.1-sol'));
    expect(db.conversation.create).toHaveBeenCalledWith({ data: { id: NEW_ID, userId: 'user-1' } });
  });

  it('names the chat with GPT-5.6 Luna, saves it only if untitled, and streams the title', async () => {
    const events = await readEvents(
      await post({ message: 'Explain TCP congestion control', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true })
    );

    expect(events).toContainEqual({ title: 'TCP Congestion Control' });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: NEW_ID, title: null },
      data: { title: 'TCP Congestion Control' },
    });
    // The title is not just a copy of the first message.
    expect(events).not.toContainEqual({ title: 'Explain TCP congestion control' });
  });

  it('does not stream a title if the user renamed the chat first', async () => {
    db.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
    const events = await readEvents(
      await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true })
    );
    expect(events.some((e) => e !== '[DONE]' && 'title' in e)).toBe(false);
  });

  it('streams reasoning separately from the answer and persists only the answer', async () => {
    const events = await readEvents(
      await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true, thinkingLevel: 'high' })
    );
    expect(events).toContainEqual({ reasoning: 'Thinking it over' });
    expect(events.filter((e) => e !== '[DONE]' && 'chunk' in e).map((e) => (e as { chunk: string }).chunk).join('')).toBe('Slow start doubles cwnd.');
    expect(log).toContain('db:messages:user=Explain TCP|assistant=Slow start doubles cwnd.');
    const saved = events.find((event) => event !== '[DONE]' && 'savedMessages' in event);
    expect(saved).toMatchObject({ savedMessages: {
      userMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      assistantMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    } });
    expect(events.at(-1)).toBe('[DONE]');
  });
});

describe('POST /api/chat, existing conversation', () => {
  it('does not create a new row or a new title', async () => {
    const events = await readEvents(
      await post({ message: 'And fast recovery?', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID })
    );
    expect(db.conversation.create).not.toHaveBeenCalled();
    expect(log).not.toContain('openrouter:title');
    expect(events.some((e) => e !== '[DONE]' && 'conversationCreated' in e)).toBe(false);
    expect(log.some((entry) => entry.startsWith('db:messages:user=And fast recovery?'))).toBe(true);
  });

  it('reads owned documents for the model and stores references without payload bytes', async () => {
    const markdown = Buffer.from('# Project plan').toString('base64');
    const pdf = Buffer.from('%PDF-1.7\nexample').toString('base64');
    documentRows.set(PLAN_ID, { id: PLAN_ID, userId: 'user-1', name: 'plan.md', mimeType: 'text/markdown', size: 14, storageKey: 'users/user-1/plan' });
    documentRows.set(PDF_ID, { id: PDF_ID, userId: 'user-1', name: 'brief.pdf', mimeType: 'application/pdf', size: 16, storageKey: 'users/user-1/pdf' });
    const attachments = [
      { documentId: PLAN_ID, name: 'plan.md', mimeType: 'text/markdown', size: 14 },
      { documentId: PDF_ID, name: 'brief.pdf', mimeType: 'application/pdf', size: 16 },
    ];
    await readEvents(await post({ message: 'Summarize', selectedModel: 'deepseek/deepseek-v4.1-flash-1017', conversationId: NEW_ID, attachments }));

    const content = openRouterBodies()[0].messages.at(-1).content;
    expect(content).toEqual([
      { type: 'text', text: 'Summarize' },
      { type: 'text', text: 'File: plan.md\n\n# Project plan' },
      { type: 'file', file: { filename: 'brief.pdf', file_data: `data:application/pdf;base64,${pdf}` } },
    ]);
    expect(db.message.createMany.mock.calls[0][0].data[0].attachments).toEqual(attachments);
    expect(JSON.stringify(db.message.createMany.mock.calls[0][0])).not.toContain(markdown);
    expect(db.document.updateMany).toHaveBeenCalledOnce();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.delete).toHaveBeenCalledWith(NEW_ID);
  });

  it('replays an earlier attachment on the next turn', async () => {
    const bytes = Buffer.from('# Earlier notes');
    redis.get.mockResolvedValue([{
      role: 'user', content: 'Read this', attachments: [{
        name: 'earlier.md', mimeType: 'text/markdown', size: bytes.length, data: bytes.toString('base64'),
      }],
    }]);
    await readEvents(await post({ message: 'What did I attach?', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }));
    expect(openRouterBodies()[0].messages.at(-2).content).toEqual([
      { type: 'text', text: 'Read this' },
      { type: 'text', text: 'File: earlier.md\n\n# Earlier notes' },
    ]);
  });

  it('explains when a historical document was deleted', async () => {
    redis.get.mockResolvedValue([{
      role: 'user', content: 'Read this', attachments: [{
        documentId: PLAN_ID, name: 'old.md', mimeType: 'text/markdown', size: 20,
      }],
    }]);
    await readEvents(await post({ message: 'What did I attach?', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }));
    expect(openRouterBodies()[0].messages.at(-2).content).toEqual([
      { type: 'text', text: 'Read this' },
      { type: 'text', text: 'Previously attached file "old.md" was removed.' },
    ]);
  });

  it('refuses a document belonging to a different user before model work', async () => {
    documentRows.set(PLAN_ID, { id: PLAN_ID, userId: 'user-2', name: 'secret.md', mimeType: 'text/markdown', size: 3, storageKey: 'other' });
    const response = await post({ message: 'Read', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID,
      attachments: [{ documentId: PLAN_ID, name: 'secret.md', mimeType: 'text/markdown', size: 3 }],
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.message.createMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat, thinking level', () => {
  it.each([
    ['anthropic/claude-sonnet-5.5', 'max', 'max'],
    ['google/gemini-4-argon', 'max', 'high'],
    ['deepseek/deepseek-v4.1-flash-1017', 'off', 'none'],
  ])('sends %s the closest supported effort for %s', async (model, thinkingLevel, effort) => {
    await readEvents(await post({ message: 'hi', selectedModel: model, conversationId: NEW_ID, thinkingLevel }));
    expect(openRouterBodies().find((body) => body.model === model)?.reasoning).toEqual({ effort });
  });

  it('defaults to Medium when the client sends no level', async () => {
    await readEvents(await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }));
    expect(openRouterBodies()[0].reasoning).toEqual({ effort: 'medium' });
  });
});

describe('POST /api/chat, council mode', () => {
  it('uses the chosen members, chair and thinking level and streams council events', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const response = await post({
        message: 'Compare REST and gRPC',
        selectedModel: 'council',
        conversationId: NEW_ID,
        thinkingLevel: 'xhigh',
        council: { members: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'], chair: 'anthropic/claude-sonnet-5.5' },
      });
      const eventsPromise = readEvents(response);
      await vi.runAllTimersAsync();
      const events = await eventsPromise;

      const models = openRouterBodies().map((body) => body.model);
      expect(models).not.toContain('google/gemini-4-argon');
      expect(models).not.toContain('deepseek/deepseek-v4.1-flash-1017');
      expect(models.filter((m) => m === 'anthropic/claude-sonnet-5.5').length).toBe(3); // answer, review, chair
      expect(openRouterBodies().every((body) => body.reasoning.effort === 'xhigh')).toBe(true);

      const answers = events.filter((e) => e !== '[DONE]' && 'councilAnswer' in e);
      expect(answers).toHaveLength(2);
      expect(events.some((e) => e !== '[DONE]' && 'councilRankings' in e)).toBe(true);
      expect(events).toContainEqual({ status: 'progress', stage: 'stage3', model: 'anthropic/claude-sonnet-5.5', progress: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows members the files from earlier turns', async () => {
    const bytes = Buffer.from('# Earlier notes');
    redis.get.mockResolvedValue([{
      role: 'user', content: 'Read this', attachments: [{
        name: 'earlier.md', mimeType: 'text/markdown', size: bytes.length, data: bytes.toString('base64'),
      }],
    }]);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const response = await post({
        message: 'What did I attach?',
        selectedModel: 'council',
        conversationId: NEW_ID,
        council: { members: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'], chair: 'anthropic/claude-sonnet-5.5' },
      });
      const eventsPromise = readEvents(response);
      await vi.runAllTimersAsync();
      await eventsPromise;

      const member = openRouterBodies().find((body) => body.model === 'openai/gpt-6.1-sol');
      expect(member.messages[1].content).toEqual([
        { type: 'text', text: 'Read this' },
        { type: 'text', text: 'File: earlier.md\n\n# Earlier notes' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/chat, skills', () => {
  const addSkill = (userId = 'user-1', extra: { enabled?: boolean; files?: unknown } = {}) => skillRows.set(SKILL_ID, {
    id: SKILL_ID, userId, name: 'pirate-voice', description: 'Talk like a pirate.',
    instructions: 'Answer in pirate speak.', source: 'created', enabled: true, categories: [], files: [], metadata: {},
    version: 1, catalogId: null, createdAt: new Date(), updatedAt: new Date(), ...extra,
  });

  it('puts tagged skills in the system prompt, counts them, and saves the tags', async () => {
    addSkill();
    await readEvents(await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, skills: [SKILL_ID] }));

    const [system, developer] = openRouterBodies()[0].messages;
    expect(system.role).toBe('system');
    expect(system.content).toContain('## Active skills');
    expect(system.content).toContain('### Skill: pirate-voice');
    expect(system.content).toContain('Answer in pirate speak.');
    // The security policy still comes after the skill text.
    expect(developer.role).toBe('developer');
    expect(db.message.createMany.mock.calls[0][0].data[0]).toMatchObject({ skills: [{ id: SKILL_ID, name: 'pirate-voice' }] });
    const counted = recordLLMTokens.mock.calls[0][1];
    expect(counted).toBeGreaterThan('Explain TCP'.length + 'Slow start doubles cwnd.'.length + 'Answer in pirate speak.'.length);
  });

  it('adds nothing to the prompt or the saved message without skills', async () => {
    await readEvents(await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }));
    expect(openRouterBodies()[0].messages[0].content).not.toContain('Active skills');
    expect(db.message.createMany.mock.calls[0][0].data[0]).not.toHaveProperty('skills');
  });

  it("refuses a missing or someone else's skill before any model work", async () => {
    addSkill('user-2');
    const response = await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true, skills: [SKILL_ID] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no longer exists/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it('refuses a skill that is turned off', async () => {
    addSkill('user-1', { enabled: false });
    const response = await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, skills: [SKILL_ID] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/turned off/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists bundled files it cannot send', async () => {
    addSkill('user-1', { files: [{ path: 'references/ports.md', content: 'x' }] });
    await readEvents(await post({ message: 'Ahoy', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, skills: [SKILL_ID] }));
    expect(openRouterBodies()[0].messages[0].content).toContain('bundles files you cannot open here: references/ports.md');
  });

  it('rejects more than three or duplicate skills', async () => {
    const ids = ['a', 'b', 'c', 'd'].map((letter) => `5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a6${letter}`);
    expect((await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', skills: ids })).status).toBe(400);
    expect((await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', skills: [SKILL_ID, SKILL_ID] })).status).toBe(400);
  });

  it('gives council members and the chair the skill, but not the reviewers', async () => {
    addSkill();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const response = await post({
        message: 'Compare REST and gRPC', selectedModel: 'council', conversationId: NEW_ID, skills: [SKILL_ID],
        council: { members: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'], chair: 'anthropic/claude-sonnet-5.5' },
      });
      const eventsPromise = readEvents(response);
      await vi.runAllTimersAsync();
      await eventsPromise;

      const withSkill = openRouterBodies().filter((body) => body.messages[0].content.includes('Answer in pirate speak.'));
      // Two members in stage 1, plus the chair.
      expect(withSkill).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/chat, validation', () => {
  it('rejects signed-out requests', async () => {
    auth.mockResolvedValue(null);
    expect((await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol' })).status).toBe(401);
  });

  it('rejects an invalid thinking level or council', async () => {
    expect((await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', thinkingLevel: 'ultra' })).status).toBe(400);
    expect(
      (await post({ message: 'hi', selectedModel: 'council', council: { members: ['openai/gpt-6.1-sol'], chair: 'openai/gpt-6.1-sol' } })).status
    ).toBe(400);
  });

  it('rejects a fake PDF before creating a conversation', async () => {
    const bytes = Buffer.from('not a pdf');
    const response = await post({
      message: '', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true,
      attachments: [{ name: 'fake.pdf', mimeType: 'application/pdf', size: bytes.length, data: bytes.toString('base64') }],
    });
    expect(response.status).toBe(400);
    expect(db.conversation.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat, ownership', () => {
  it("refuses someone else's conversation before calling the model", async () => {
    const response = await post({ message: 'Show me', selectedModel: 'openai/gpt-6.1-sol', conversationId: OTHER_USERS_CHAT });
    expect(response.status).toBe(404);
    expect(db.conversation.findFirst).toHaveBeenCalledWith({ where: { id: OTHER_USERS_CHAT, userId: 'user-1' }, select: { id: true } });
    expect(redis.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.message.createMany).not.toHaveBeenCalled();
  });

  it('refuses to claim an id that is already taken', async () => {
    db.conversation.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    const response = await post({ message: 'hi', selectedModel: 'openai/gpt-6.1-sol', conversationId: OTHER_USERS_CHAT, newConversation: true });
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat, when the answer fails', () => {
  it('saves only the question, never a fake "error" answer', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === 'openai/gpt-5.6-luna') return new Response(JSON.stringify({ choices: [{ message: { content: 'T' } }] }));
      return new Response('upstream down', { status: 500 });
    });
    const events = await readEvents(await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }));

    expect(events.some((e) => e !== '[DONE]' && 'error' in e)).toBe(true);
    expect(log).toContain('db:messages:user=Explain TCP');
    expect(log.join()).not.toContain('Error generating response');
    // The prompt was still sent, so it still counts toward the limit.
    expect(recordLLMTokens).toHaveBeenCalledTimes(1);
  });

  it('a council where nobody answers is an error, not a saved answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      fetchMock.mockImplementation(async () => new Response('down', { status: 503 }));
      const response = await post({
        message: 'Compare', selectedModel: 'council', conversationId: NEW_ID,
        council: { members: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'], chair: 'anthropic/claude-sonnet-5.5' },
      });
      const eventsPromise = readEvents(response);
      await vi.runAllTimersAsync();
      const events = await eventsPromise;
      expect(events).toContainEqual({ error: 'No council member could answer. Please try again.' });
      expect(events.some((e) => e !== '[DONE]' && 'chunk' in e)).toBe(false);
      expect(log).toContain('db:messages:user=Compare');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/chat, when the user stops', () => {
  it('cancels the model call, then saves what was written and counts the tokens', async () => {
    const stop = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Slow start ' } }] })}\n\n`));
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          // The user presses Stop once the first words are on screen.
          setTimeout(() => stop.abort(), 10);
        },
      }));
    });

    const response = await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }, stop.signal);
    await readEvents(response);

    expect(upstreamSignal?.aborted).toBe(true);
    expect(log).toContain('db:messages:user=Explain TCP|assistant=Slow start ');
    expect(recordLLMTokens).toHaveBeenCalledTimes(1);
    expect(recordLLMTokens.mock.calls[0][1]).toBeGreaterThan('Explain TCP'.length);
  });
});

describe('POST /api/chat, when the user steers', () => {
  it('answers the steered message only after the interrupted turn is saved, with it in the history', async () => {
    const cache = new Map<string, unknown[]>();
    redis.get.mockImplementation(async (id: string) => cache.get(id) ?? []);
    redis.set.mockImplementation(async (id: string, messages: unknown[]) => void cache.set(id, messages));
    try {
      // The interrupted turn is slow to save, as when Postgres is busy.
      recordLLMTokens.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 30)));

      const steer = new AbortController();
      fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Long essay ' } }] })}\n\n`));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          },
        }));
      });

      const interrupted = post({ message: 'Write an essay', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }, steer.signal);
      const firstEvents = readEvents(await interrupted);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Steer: the client drops the first request and sends the next one at once.
      steer.abort();
      const steered = await post({ message: 'Keep it short', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID });
      await Promise.allSettled([firstEvents]);
      await readEvents(steered);

      const steeredBody = openRouterBodies().at(-1);
      const sent = steeredBody.messages.map((m: { role: string; content: unknown }) =>
        `${m.role}=${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
      expect(sent).toEqual(expect.arrayContaining(['user=Write an essay', 'assistant=Long essay ']));
      expect(sent.at(-1)).toContain('Keep it short');
      // The cache ends with both turns, in order.
      expect((cache.get(NEW_ID) as Array<{ content: string }>).map((m) => m.content)).toEqual([
        'Write an essay', 'Long essay ', 'Keep it short', 'Slow start doubles cwnd.',
      ]);
    } finally {
      redis.get.mockImplementation(async () => []);
      redis.set.mockImplementation(async () => {});
    }
  });
});

describe('POST /api/chat, auto compaction', () => {
  const history = [
    { id: 'm1', role: 'user', content: 'First question. ' + 'alpha '.repeat(100), createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'm2', role: 'assistant', content: 'First answer. ' + 'beta '.repeat(100), modelId: 'openai/gpt-6.1-sol', createdAt: '2026-01-01T00:00:01.000Z' },
    { id: 'm3', role: 'user', content: 'Second question. ' + 'gamma '.repeat(100), createdAt: '2026-01-01T00:00:02.000Z' },
    { id: 'm4', role: 'assistant', content: 'Second answer. ' + 'delta '.repeat(100), modelId: 'openai/gpt-6.1-sol', createdAt: '2026-01-01T00:00:03.000Z' },
    { id: 'm5', role: 'user', content: 'Third question. ' + 'epsilon '.repeat(100), createdAt: '2026-01-01T00:00:04.000Z' },
    { id: 'm6', role: 'assistant', content: 'Third answer. ' + 'zeta '.repeat(100), modelId: 'openai/gpt-6.1-sol', createdAt: '2026-01-01T00:00:05.000Z' },
  ];

  const goodSummary = `## Current goal
Keep working on the TCP task.

## Durable instructions and preferences
Use TypeScript and short answers.

## Established facts
The first exchange is complete.

## Decisions and rationale
Keep the existing API.

## Unresolved work
Verify the last two exchanges.

## Exact details
Port 3000.`;

  const installFetch = (summary: string) => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === 'openai/gpt-5.6-luna') {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'TCP' } }] }));
      }
      if (body.model === 'openai/gpt-4o-mini') {
        log.push('openrouter:summary');
        return sseResponse([delta({ content: summary }), '[DONE]']);
      }
      return sseResponse([delta({ content: 'Fresh answer.' }), '[DONE]']);
    });
  };

  beforeEach(() => {
    vi.stubEnv('CHAT_COMPACTION_MODE', 'on');
    vi.stubEnv('COMPACTION_TRIGGER_MAX_TOKENS', '200');
    vi.stubEnv('COMPACTION_RECENT_EXCHANGES', '2');
  });

  it('summarizes older turns, keeps the last two exchanges, and leaves the transcript alone', async () => {
    redis.get.mockResolvedValue(history);
    installFetch(goodSummary);

    const events = await readEvents(
      await post({ message: 'And now?', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID })
    );

    const snapshot = snapshotRows.get(NEW_ID);
    expect(snapshot).toMatchObject({ throughMessageId: 'm2', summaryModelId: 'openai/gpt-4o-mini', version: 1 });
    expect(log).toContain('db:snapshot:create');
    // The full exchange is still persisted: compaction is only a model view.
    expect(log).toContain('db:messages:user=And now?|assistant=Fresh answer.');
    expect(events).toContainEqual(expect.objectContaining({
      contextCompacted: expect.objectContaining({ throughMessageId: 'm2', summaryTokens: expect.any(Number) }),
    }));

    const sent = openRouterBodies().find((body) => body.model === 'openai/gpt-6.1-sol').messages;
    expect(sent[2].content).toContain('## Earlier conversation summary');
    expect(sent[2].content).toContain('## Current goal');
    expect(sent.slice(3, 7).map((message: { content: string }) => message.content)).toEqual([
      'Second question. ' + 'gamma '.repeat(100),
      'Second answer. ' + 'delta '.repeat(100),
      'Third question. ' + 'epsilon '.repeat(100),
      'Third answer. ' + 'zeta '.repeat(100),
    ]);
    expect(sent.at(-1).content).toBe('And now?');
  });

  it('keeps the full history when the summary is malformed', async () => {
    redis.get.mockResolvedValue(history);
    installFetch('not a summary');

    await readEvents(
      await post({ message: 'And now?', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID })
    );

    expect(snapshotRows.has(NEW_ID)).toBe(false);
    expect(log).not.toContain('db:snapshot:create');
    const sent = openRouterBodies().find((body) => body.model === 'openai/gpt-6.1-sol').messages;
    expect(sent.some((message: { content: string }) => message.content.includes('## Earlier conversation summary'))).toBe(false);
    expect(sent.map((message: { content: string }) => message.content)).toEqual(
      expect.arrayContaining([history[0].content, history[1].content])
    );
  });

  it('counts a failed summarizer request even when the answer uses full history', async () => {
    redis.get.mockResolvedValue(history);
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === 'openai/gpt-4o-mini') {
        log.push('openrouter:summary');
        return new Response('summary unavailable', { status: 503 });
      }
      return sseResponse([delta({ content: 'Fresh answer.' }), '[DONE]']);
    });

    await readEvents(await post({ message: 'And now?', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }));

    expect(log).toContain('openrouter:summary');
    expect(log).toContain('db:messages:user=And now?|assistant=Fresh answer.');
    expect(recordLLMTokens).toHaveBeenCalledOnce();
    const charged = recordLLMTokens.mock.calls[0][1];
    const mainPrompt = openRouterBodies().find((body) => body.model === 'openai/gpt-6.1-sol').messages
      .filter((message: { role: string }) => message.role === 'user' || message.role === 'assistant')
      .map((message: { content: string }) => message.content).join('\n');
    expect(charged).toBeGreaterThan(mainPrompt.length + 'Fresh answer.'.length);
  });

  it('keeps a snapshot on a failed retry, then drops it after a successful replacement', async () => {
    redis.get.mockResolvedValue(history);
    snapshotRows.set(NEW_ID, {
      id: 'snapshot-1', conversationId: NEW_ID, throughMessageId: 'm6',
      sourceHash: 'old-prefix', version: 1, schemaVersion: 1,
      summaryText: goodSummary, summaryModelId: 'openai/gpt-4o-mini',
      inputTokensBefore: 5000, inputTokensAfter: 1000, summaryTokens: 100,
    });
    fetchMock.mockImplementation(async () => new Response('provider down', { status: 503 }));

    await readEvents(await post({
      message: history[4].content, selectedModel: 'openai/gpt-6.1-sol',
      conversationId: NEW_ID, retry: true,
    }));
    expect(snapshotRows.has(NEW_ID)).toBe(true);
    expect(db.message.deleteMany).not.toHaveBeenCalled();

    installFetch(goodSummary);
    await readEvents(await post({
      message: history[4].content, selectedModel: 'openai/gpt-6.1-sol',
      conversationId: NEW_ID, retry: true,
    }));
    expect(db.message.deleteMany).toHaveBeenCalled();
    expect(snapshotRows.has(NEW_ID)).toBe(false);
  });
});

describe('POST /api/chat, history cache', () => {
  it('refills an empty cache from the database in one write, and saves the turn in one more', async () => {
    // A cache that actually caches, so the second history read (after the
    // rate-limit reservation) hits it instead of the database again.
    const cache = new Map<string, unknown[]>();
    redis.get.mockImplementation(async (id: string) => cache.get(id) ?? []);
    redis.set.mockImplementation(async (id: string, messages: unknown[]) => void cache.set(id, [...messages]));
    try {
      db.message.findMany.mockResolvedValueOnce([
        { role: 'user', content: 'Earlier question', modelId: null },
        { role: 'assistant', content: 'Earlier answer', modelId: 'openai/gpt-6.1-sol' },
      ]);
      await readEvents(await post({ message: 'And now?', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID }));

      expect(redis.set).toHaveBeenCalledTimes(2);
      const [, final] = redis.set.mock.calls[1];
      expect((final as Array<{ content: string }>).map((m) => m.content)).toEqual([
        'Earlier question', 'Earlier answer', 'And now?', 'Slow start doubles cwnd.',
      ]);
      // The model saw the history.
      const sent = openRouterBodies().find((b) => b.model === 'openai/gpt-6.1-sol').messages.map((m: { content: string }) => m.content);
      expect(sent).toEqual(expect.arrayContaining(['Earlier question', 'Earlier answer']));
    } finally {
      redis.get.mockReset().mockImplementation(async () => []);
      redis.set.mockReset().mockImplementation(async () => {});
    }
  });
});

describe('POST /api/chat, completion analytics', () => {
  it('reports the tokens and time of the finished answer, before the stream ends', async () => {
    const events = await readEvents(
      await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true })
    );
    // countTokens is stubbed as the character count in this file.
    const analytics = events.find((e) => e !== '[DONE]' && 'analytics' in e) as {
      analytics: { inputTokens: number; outputTokens: number; totalTokens: number; durationMs: number; timings?: unknown[] };
    };
    expect(analytics.analytics.inputTokens).toBe('Explain TCP'.length);
    expect(analytics.analytics.outputTokens).toBe('Slow start doubles cwnd.'.length);
    expect(analytics.analytics.totalTokens).toBe('Explain TCP'.length + 'Slow start doubles cwnd.'.length);
    expect(analytics.analytics.durationMs).toBeTypeOf('number');
    // One model call: nothing to break the total down into.
    expect(analytics.analytics.timings).toBeUndefined();

    const analyticsAt = events.findIndex((e) => e !== '[DONE]' && 'analytics' in e);
    const doneAt = events.findIndex((e) => e !== '[DONE]' && (e as { done?: boolean }).done === true);
    // The client stops reading at done, so the numbers have to arrive first.
    expect(analyticsAt).toBeLessThan(doneAt);
  });

  it('breaks a council run down per model call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const eventsPromise = readEvents(await post({
        message: 'Compare REST and gRPC',
        selectedModel: 'council',
        conversationId: NEW_ID,
        council: { members: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'], chair: 'anthropic/claude-sonnet-5.5' },
      }));
      await vi.runAllTimersAsync();
      const events = await eventsPromise;

      const analytics = events.find((e) => e !== '[DONE]' && 'analytics' in e) as {
        analytics: { timings: Array<{ model: string; stage: string; durationMs: number }> };
      };
      const calls = analytics.analytics.timings.map((t) => t.stage + ':' + t.model);
      expect(calls).toContain('stage1:openai/gpt-6.1-sol');
      expect(calls).toContain('stage2:anthropic/claude-sonnet-5.5');
      expect(calls).toContain('stage3:anthropic/claude-sonnet-5.5');
      // Answers + reviews from both members, then the chair writing the answer.
      expect(calls).toHaveLength(5);
      expect(analytics.analytics.timings.every((t) => typeof t.durationMs === 'number')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/chat, retry', () => {
  const history = [
    { role: 'user', content: 'Explain TCP' },
    { role: 'assistant', content: 'An answer the user did not like.' },
  ];

  it('drops the replaced answer from the prompt and saves the new pair in its place', async () => {
    redis.get.mockImplementation(async () => history);
    try {
      const events = await readEvents(
        await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, retry: true })
      );
      expect(events.some((e) => e !== '[DONE]' && 'analytics' in e)).toBe(true);
    } finally {
      redis.get.mockImplementation(async () => []);
    }

    const sent = openRouterBodies()[0].messages.map((m: { content: string }) => m.content);
    // The question is asked once, and the answer it replaces is never shown again.
    expect(sent.filter((content: string) => content === 'Explain TCP')).toHaveLength(1);
    expect(sent).not.toContain('An answer the user did not like.');

    expect(log).toContain('db:deleteExchange');
    expect(log).toContain('db:messages:user=Explain TCP|assistant=Slow start doubles cwnd.');
    const saved = redis.set.mock.calls.at(-1)![1] as Array<{ content: string }>;
    expect(saved.map((m) => m.content)).toEqual(['Explain TCP', 'Slow start doubles cwnd.']);
  });

  it('keeps the answer it was replacing when the retry produces nothing', async () => {
    redis.get.mockImplementation(async () => history);
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === 'openai/gpt-5.6-luna') return new Response(JSON.stringify({ choices: [{ message: { content: 'T' } }] }));
      return new Response('upstream down', { status: 500 });
    });
    try {
      const events = await readEvents(await post({ message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, retry: true }));
      expect(events.some((e) => e !== '[DONE]' && 'error' in e)).toBe(true);
    } finally {
      redis.get.mockImplementation(async () => []);
    }
    // Nothing was deleted and nothing was written: the saved pair is untouched.
    expect(db.message.deleteMany).not.toHaveBeenCalled();
    expect(db.message.createMany).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.delete).not.toHaveBeenCalled();
  });

  it('replaces nothing when the chat is brand new', async () => {
    await readEvents(await post({
      message: 'Explain TCP', selectedModel: 'openai/gpt-6.1-sol', conversationId: NEW_ID, newConversation: true, retry: true,
    }));
    expect(db.message.deleteMany).not.toHaveBeenCalled();
  });
});
