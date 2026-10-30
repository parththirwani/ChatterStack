/**
 * Forking a chat at one message: the real route and service against an
 * in-memory Prisma, so ownership, the cut point and the all-or-nothing write are
 * exercised without a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown> & { id: string };

const tables = {
  conversation: new Map<string, Row>(),
  message: new Map<string, Row>(),
  document: new Map<string, Row>(),
  skill: new Map<string, Row>(),
};

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

function matches(row: Row, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const check = condition as { in?: unknown[]; gte?: Date | number; lte?: Date | number };
      if (check.in) return check.in.includes(value);
      if (check.gte !== undefined) return (value as number) >= (check.gte as number);
      if (check.lte !== undefined) return (value as number) <= (check.lte as number);
    }
    return same(value, condition);
  });
}

/** The order the app reads messages in: position first, time and id to settle ties. */
function inOrder(rows: Row[]): Row[] {
  const time = (row: Row) => (row.createdAt as Date).getTime();
  return [...rows].sort(
    (a, b) => ((a.position as number | null) ?? 0) - ((b.position as number | null) ?? 0)
      || time(a) - time(b)
      || String(a.id).localeCompare(String(b.id))
  );
}

function pick(row: Row, select: Record<string, boolean> | undefined) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key]) => [key, row[key]]));
}

function table(name: keyof typeof tables, defaults: () => Record<string, unknown> = () => ({})) {
  const rows = tables[name];
  return {
    findFirst: vi.fn(async ({ where, include, select }: { where?: Record<string, unknown>; include?: { messages?: unknown }; select?: Record<string, boolean> } = {}) => {
      const found = [...rows.values()].find((row) => matches(row, where));
      if (!found) return null;
      const withMessages = include
        ? { ...found, messages: inOrder([...tables.message.values()].filter((m) => m.conversationId === found.id)) }
        : found;
      return pick(withMessages as Row, select);
    }),
    findMany: vi.fn(async ({ where, include }: { where?: Record<string, unknown>; include?: { messages?: unknown } } = {}) => {
      const found = [...rows.values()].filter((row) => matches(row, where));
      return found.map((row) => (include
        ? { ...row, messages: inOrder([...tables.message.values()].filter((m) => m.conversationId === row.id)) }
        : { ...row }));
    }),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
      [...rows.values()].filter((row) => matches(row, where)).length),
    create: vi.fn(async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const row = { id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...data } as Row;
      rows.set(row.id, row);
      return pick(row, select);
    }),
  };
}

const conversationTable = table('conversation', () => ({ title: null, pinnedAt: null, scheduledTaskId: null, parentConversationId: null, forkedFromMessageId: null }));
const documentTable = table('document');
const skillTable = table('skill');

const messageTable = {
  ...table('message', () => ({ modelId: null, attachments: null, skills: null })),
  findMany: vi.fn(async ({ where }: { where?: Record<string, unknown>; orderBy?: unknown } = {}) =>
    inOrder([...tables.message.values()].filter((row) => matches(row, where)).map((row) => ({ ...row })))),
  createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
    const list = Array.isArray(data) ? data : [data];
    for (const item of list) {
      tables.message.set(item.id as string ?? crypto.randomUUID(), {
        id: (item.id as string) ?? crypto.randomUUID(),
        modelId: null, attachments: null, skills: null, updatedAt: new Date(),
        ...item,
      } as Row);
    }
    return { count: list.length };
  }),
  aggregate: vi.fn(async () => ({
    _max: { position: Math.max(0, ...inOrder([...tables.message.values()]).map((row) => (row.position as number | null) ?? 0)) },
  })),
};

// The tables a transaction callback gets to work with.
const client = { conversation: conversationTable, message: messageTable, document: documentTable, skill: skillTable };

const db = {
  ...client,
  // Prisma's $transaction takes either a list of operations or a callback with
  // the transactional client. A callback that throws rolls the tables back.
  $transaction: vi.fn(async (work: (tx: typeof client) => unknown) => {
    const state = snapshot();
    try {
      return await work(client);
    } catch (error) {
      restore(state);
      throw error;
    }
  }),
};

const snapshot = () => Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, [...rows.values()].map((row) => ({ ...row }))]));
function restore(state: Record<string, Row[]>) {
  for (const [name, rows] of Object.entries(state)) {
    const table = tables[name as keyof typeof tables];
    table.clear();
    rows.forEach((row) => table.set(row.id, row));
  }
}

const auth = vi.fn();
const redis = { get: vi.fn(async () => []), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) };

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
vi.mock('@/src/lib/redis', () => ({ redisStore: redis }));

const fork = await import('@/src/app/api/conversations/[id]/fork/route');
const single = await import('@/src/app/api/conversations/[id]/route');

const CHAT = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_CHAT = '22222222-2222-4222-8222-222222222222';
const RUN_CHAT = '33333333-3333-4333-8333-333333333333';
const FOREIGN_MESSAGE = '44444444-4444-4444-8444-444444444444';
const NO_CHAT = '77777777-7777-4777-8777-777777777777';
const NO_MESSAGE = '88888888-8888-4888-8888-888888888888';
const MISSING_DOCUMENT = '55555555-5555-5555-8555-555555555555';
const LIVE_DOCUMENT = '66666666-6666-6666-8666-666666666666';

function post(id: string, body: unknown) {
  return fork.POST(
    new Request('http://localhost/api/conversations/' + id + '/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) }
  );
}

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 20, 9) - minutesAgo * 60_000);
/** Saved message ids are uuids, so the route accepts them as a cut point. */
const mid = (n: number) => '11111111-1111-4111-8111-11111111111' + n;

/** Three exchanges, numbered 1..6, in one chat owned by user-1. */
function seedChat() {
  tables.conversation.set(CHAT, {
    id: CHAT, userId: 'user-1', title: 'Caching plan', pinnedAt: null, scheduledTaskId: null,
    parentConversationId: null, forkedFromMessageId: null, createdAt: at(60), updatedAt: at(1),
  });
  const exchange = [
    { role: 'user', content: 'How does write-back caching work?', attachments: [{ documentId: LIVE_DOCUMENT, name: 'spec.pdf', mimeType: 'application/pdf', size: 12 }], skills: [{ id: 'skill-1', name: 'review' }] },
    { role: 'assistant', content: 'It defers writes.', modelId: 'openai/gpt-6.1-sol' },
    { role: 'user', content: 'What about the risks?' },
    { role: 'assistant', content: 'Lost writes after a crash.', modelId: 'openai/gpt-6.1-sol' },
    { role: 'user', content: 'Give me a checklist' },
    { role: 'assistant', content: '1. Fsync 2. Battery-backed cache' },
  ];
  exchange.forEach((message, index) => {
    tables.message.set(mid(index + 1), {
      id: mid(index + 1), conversationId: CHAT, position: index + 1, modelId: null,
      attachments: null, skills: null,
      ...message,
      createdAt: at(60 - index), updatedAt: at(60 - index),
    } as Row);
  });
  tables.conversation.set(OTHER_USER_CHAT, { id: OTHER_USER_CHAT, userId: 'user-2', title: 'Not yours', pinnedAt: null, scheduledTaskId: null, createdAt: at(90), updatedAt: at(90) });
  tables.conversation.set(RUN_CHAT, { id: RUN_CHAT, userId: 'user-1', title: 'Morning brief run', pinnedAt: null, scheduledTaskId: 'task-1', createdAt: at(90), updatedAt: at(90) });
  tables.message.set(FOREIGN_MESSAGE, { id: FOREIGN_MESSAGE, conversationId: OTHER_USER_CHAT, position: 1, role: 'user', content: 'Their question', modelId: null, attachments: null, skills: null, createdAt: at(90), updatedAt: at(90) });
  tables.document.set(LIVE_DOCUMENT, { id: LIVE_DOCUMENT, userId: 'user-1', name: 'spec.pdf' });
  tables.skill.set('skill-1', { id: 'skill-1', userId: 'user-1', name: 'review' });
}

const savedConversations = () => [...tables.conversation.values()];
const savedMessages = (conversationId: string) => inOrder([...tables.message.values()].filter((row) => row.conversationId === conversationId));

beforeEach(() => {
  Object.values(tables).forEach((rows) => rows.clear());
  Object.values(db.conversation).forEach((fn) => fn.mockClear());
  Object.values(db.message).forEach((fn) => fn.mockClear());
  db.$transaction.mockClear();
  redis.get.mockClear();
  redis.set.mockClear();
  redis.delete.mockClear();
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedChat();
});

describe('POST /api/conversations/[id]/fork', () => {
  it('copies the chat up to and including the chosen message', async () => {
    const response = await post(CHAT, { messageId: mid(4) });
    expect(response.status).toBe(201);
    const { conversation } = await response.json();

    expect(conversation.id).not.toBe(CHAT);
    expect(conversation.userId).toBe('user-1');
    expect(conversation.title).toBe('Fork of Caching plan');
    expect(conversation.pinnedAt).toBeNull();
    expect(conversation.messages.map((message: { role: string; content: string }) => message.content)).toEqual([
      'How does write-back caching work?',
      'It defers writes.',
      'What about the risks?',
      'Lost writes after a crash.',
    ]);
    // Renumbered from 1 so the copy is dense, with its own row ids.
    expect(conversation.messages.map((message: { position: number }) => message.position)).toEqual([1, 2, 3, 4]);
    // Copied rows get their own ids.
    expect(conversation.messages.map((message: { id: string }) => message.id)).not.toContain(mid(1));
  });

  it('ends a fork at a question with the question, without its answer', async () => {
    const { conversation } = await (await post(CHAT, { messageId: mid(5) })).json();
    expect(conversation.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(savedMessages(conversation.id).at(-1)!.role).toBe('user');
  });

  it('keeps model labels, attachment and skill references, and the original times', async () => {
    const { conversation } = await (await post(CHAT, { messageId: mid(2) })).json();
    const [question, answer] = conversation.messages;

    expect(question.attachments).toEqual([{ documentId: LIVE_DOCUMENT, name: 'spec.pdf', mimeType: 'application/pdf', size: 12, removed: false }]);
    expect(question.skills).toEqual([{ id: 'skill-1', name: 'review', removed: false }]);
    expect(answer.modelId).toBe('openai/gpt-6.1-sol');
    expect(question.createdAt).toBe(at(60).toISOString());
    expect(answer.createdAt).toBe(at(59).toISOString());
  });

  it('shows a copied attachment or skill that has since been deleted as removed', async () => {
    tables.message.get(mid(1))!.attachments = [{ documentId: MISSING_DOCUMENT, name: 'gone.pdf', mimeType: 'application/pdf', size: 3 }];
    tables.message.get(mid(1))!.skills = [{ id: 'skill-gone', name: 'gone' }];

    const { conversation } = await (await post(CHAT, { messageId: mid(1) })).json();
    expect(conversation.messages[0].attachments).toEqual([{ documentId: MISSING_DOCUMENT, name: 'gone.pdf', mimeType: 'application/pdf', size: 3, removed: true }]);
    expect(conversation.messages[0].skills).toEqual([{ id: 'skill-gone', name: 'gone', removed: true }]);
  });

  it('remembers where the fork came from and leaves the source alone', async () => {
    const before = savedConversations().find((row) => row.id === CHAT)!;
    const sourceUpdatedAt = before.updatedAt as Date;
    const { conversation } = await (await post(CHAT, { messageId: mid(3) })).json();

    const saved = savedConversations().find((row) => row.id === conversation.id)!;
    expect(saved.parentConversationId).toBe(CHAT);
    expect(saved.forkedFromMessageId).toBe(mid(3));
    expect(saved.scheduledTaskId).toBeNull();

    expect(before).toMatchObject({ title: 'Caching plan', pinnedAt: null, updatedAt: sourceUpdatedAt });
    expect(savedMessages(CHAT)).toHaveLength(6);
  });

  it('titles an untitled chat after its first question and never past 80 characters', async () => {
    tables.conversation.get(CHAT)!.title = null;
    const { conversation } = await (await post(CHAT, { messageId: mid(1) })).json();
    expect(conversation.title).toBe('Fork of How does write-back caching work?');

    tables.conversation.get(CHAT)!.title = 'x'.repeat(200);
    const long = await (await post(CHAT, { messageId: mid(1) })).json();
    expect(long.conversation.title).toHaveLength(80);
    expect(long.conversation.title.startsWith('Fork of ')).toBe(true);
  });

  it('reads the source in saved order and writes the fork in one transaction', async () => {
    await post(CHAT, { messageId: mid(2) });
    expect(db.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CHAT, userId: 'user-1', scheduledTaskId: null },
    }));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const sourceQuery = db.message.findMany.mock.calls[0]?.[0] as { orderBy?: unknown } | undefined;
    expect(sourceQuery?.orderBy).toEqual([
      { position: { sort: 'asc', nulls: 'first' } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(db.conversation.create).toHaveBeenCalledTimes(1);
    expect(db.message.createMany).toHaveBeenCalledTimes(1);
  });

  it('leaves no half-made fork when a write fails, and says nothing useful about it', async () => {
    const failure = new Error('connect ECONNREFUSED 10.0.0.7:5432 messages_pkey');
    db.message.createMany.mockRejectedValueOnce(failure);
    const count = savedConversations().length;

    const response = await post(CHAT, { messageId: mid(4) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to fork conversation' });
    expect(savedConversations()).toHaveLength(count);
  });

  it('rolls back the fork when reading its response fails', async () => {
    const count = savedConversations().length;
    // The source read succeeds; the read of the newly created fork fails.
    db.conversation.findFirst.mockResolvedValueOnce({ id: CHAT, title: 'Caching plan' });
    db.conversation.findFirst.mockRejectedValueOnce(new Error('response read failed'));

    const response = await post(CHAT, { messageId: mid(2) });
    expect(response.status).toBe(500);
    expect(savedConversations()).toHaveLength(count);
  });

  it('gives up without a fork if the chosen message goes missing mid-write', async () => {
    const count = savedConversations().length;
    // The snapshot the copy is made from no longer holds the chosen row.
    db.message.findMany.mockImplementationOnce(async () => []);

    const response = await post(CHAT, { messageId: mid(4) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Conversation not found' });
    expect(savedConversations()).toHaveLength(count);
    expect(savedMessages(CHAT)).toHaveLength(6);
  });

  it('never reads or writes the source chat Redis history', async () => {
    const { conversation } = await (await post(CHAT, { messageId: mid(2) })).json();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.delete).not.toHaveBeenCalled();
    // The copy reads its own rows from Postgres instead.
    expect(savedMessages(conversation.id)).toHaveLength(2);
  });

  it('answers exactly like the single-chat read does', async () => {
    const { conversation } = await (await post(CHAT, { messageId: mid(4) })).json();
    const read = await single.GET(
      new Request('http://localhost/api/conversations/' + conversation.id) as unknown as NextRequest,
      { params: Promise.resolve({ id: conversation.id }) }
    );
    expect((await read.json()).conversation).toEqual(conversation);
  });
});

describe('POST /api/conversations/[id]/fork, refusals', () => {
  it('requires sign-in and creates nothing', async () => {
    auth.mockResolvedValue(null);
    const count = savedConversations().length;
    expect((await post(CHAT, { messageId: mid(1) })).status).toBe(401);
    expect(savedConversations()).toHaveLength(count);
  });

  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['a message id that is not a uuid', { messageId: 'not-a-uuid' }],
    ['a missing message id', { conversationId: CHAT }],
    ['anything extra', { messageId: mid(1), title: 'Surprise' }],
  ])('rejects %s with 400', async (_label, body) => {
    const count = savedConversations().length;
    expect((await post(CHAT, body)).status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(savedConversations()).toHaveLength(count);
  });

  it('rejects a chat id that is not a uuid with 400', async () => {
    expect((await post('not-a-chat-id', { messageId: mid(1) })).status).toBe(400);
    expect(db.conversation.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['a chat that does not exist', NO_CHAT, mid(1)],
    ['someone else chat', OTHER_USER_CHAT, mid(1)],
    ['a scheduled task run chat', RUN_CHAT, mid(1)],
    ['a message from another chat', CHAT, FOREIGN_MESSAGE],
    ['a message that does not exist', CHAT, NO_MESSAGE],
  ])('answers 404 the same way for %s', async (_label, id, messageId) => {
    const response = await post(id, { messageId });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Conversation not found' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
