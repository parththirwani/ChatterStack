/**
 * Tool-history integrity: an MCP turn that was saved once must survive every
 * later path unchanged - a cache refill, a Redis replay, a retry, a compaction
 * and a fork all show the model the same assistant-calls-then-one-result-per-
 * call sequence, and the summarizer sees which tools ran. Real route, real
 * persistence, real fork service; only the storage and network edges are faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { delta, readEvents, sseResponse } from '../helpers/sse';

const auth = vi.fn();
const MODEL = 'openai/gpt-6.1-sol';
const CONVERSATION_ID = '2c9d4e1f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';

type Row = Record<string, unknown>;
const messageRows = new Map<string, Row & { id: string }>();
const toolCallRows: Row[] = [];
const snapshotRows = new Map<string, Row>();

const byOrder = (a: Row, b: Row) =>
  ((a.position as number | null) ?? 0) - ((b.position as number | null) ?? 0) ||
  (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime();
const toolViewsOf = (messageId: string) =>
  toolCallRows.filter((row) => row.messageId === messageId).sort((a, b) => (a.position as number) - (b.position as number));
const messageWithTools = (row: Row) => ({ ...row, toolCalls: toolViewsOf(row.id as string) });

const conversationTable = {
  create: vi.fn(async ({ data }: { data: Row & { id?: string } }) => {
    const row = { id: data.id ?? crypto.randomUUID(), title: null, ...data };
    return row;
  }),
  update: vi.fn(async ({ data }: { data: Row }) => ({ ...data })),
  updateMany: vi.fn(async () => ({ count: 1 })),
  findFirst: vi.fn(async ({ where, include }: { where: { id: string; userId?: string }; include?: unknown }) => {
    if (where.userId && where.userId !== authUserId) {
      return include ? null : (where.id === FORK_SOURCE ? { id: where.id, title: 'Source chat' } : null);
    }
    if (!include) return { id: where.id, title: 'Source chat' };
    const messages = [...messageRows.values()].filter((row) => row.conversationId === where.id).sort(byOrder).map(messageWithTools);
    return { id: where.id, title: 'Source chat', pinnedAt: null, scheduledTaskId: null, parentConversationId: null, forkedFromMessageId: null, userId: where.userId, createdAt: new Date(), updatedAt: new Date(), messages };
  }),
};

const FORK_SOURCE = '7f6e5d4c-3b2a-1908-7654-3210fedcba98';
let authUserId = 'user-1';

const messageTable = {
  findMany: vi.fn(async ({ where }: { where: { conversationId: string } }) =>
    [...messageRows.values()].filter((row) => row.conversationId === where.conversationId).sort(byOrder).map(messageWithTools)),
  createMany: vi.fn(async ({ data }: { data: Array<Row & { id: string }> }) => {
    for (const row of data) messageRows.set(row.id, { createdAt: new Date(), ...row });
    return { count: data.length };
  }),
  findFirst: vi.fn(async ({ where }: { where: { id?: string; conversationId?: string } }) => {
    if (where.id) return [...messageRows.values()].find((row) => row.id === where.id) ?? null;
    return [...messageRows.values()].filter((row) => row.conversationId === where.conversationId).sort(byOrder).at(-1) ?? null;
  }),
  deleteMany: vi.fn(async ({ where }: { where: { conversationId: string } }) => {
    // Emulate the FK cascade: dropping a turn takes its tool calls with it.
    let count = 0;
    for (const [id, row] of messageRows) {
      if (row.conversationId === where.conversationId) {
        messageRows.delete(id);
        count += 1;
      }
    }
    for (let index = toolCallRows.length - 1; index >= 0; index -= 1) {
      if (!messageRows.has(toolCallRows[index].messageId as string)) toolCallRows.splice(index, 1);
    }
    return { count };
  }),
  aggregate: vi.fn(async () => ({ _max: { position: null } })),
  count: vi.fn(async () => 0),
};

const messageToolCallTable = {
  createMany: vi.fn(async ({ data }: { data: Row[] }) => {
    for (const row of data) toolCallRows.push({ id: crypto.randomUUID(), createdAt: new Date(), ...row });
    return { count: data.length };
  }),
};

const db = {
  $queryRaw: vi.fn(async () => []),
  message: messageTable,
  messageToolCall: messageToolCallTable,
  conversation: conversationTable,
  mcpConnection: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
  skill: { findMany: vi.fn(async () => []) },
  document: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  conversationContextSnapshot: {
    findUnique: vi.fn(async ({ where }: { where: { conversationId: string } }) => snapshotRows.get(where.conversationId) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: 'snapshot-1', version: 1, schemaVersion: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
      snapshotRows.set(String(data.conversationId), row);
      return row;
    }),
    updateMany: vi.fn(async () => ({ count: 0 })),
    deleteMany: vi.fn(async ({ where }: { where: { conversationId: string } }) => ({ count: snapshotRows.delete(where.conversationId) ? 1 : 0 })),
  },
  $transaction: vi.fn(async (work: (tx: unknown) => unknown) =>
    work({ $queryRaw: db.$queryRaw, message: messageTable, messageToolCall: messageToolCallTable, conversation: conversationTable })),
};

const redis = {
  get: vi.fn<(id: string) => Promise<unknown[]>>(async () => []),
  set: vi.fn<(id: string, messages: unknown[]) => Promise<void>>(async () => {}),
  delete: vi.fn(async () => {}),
  isReady: vi.fn(() => false),
  hasConfiguration: vi.fn(() => false),
};

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
vi.mock('@/src/lib/redis', () => ({ redisStore: redis }));
vi.mock('@/src/lib/api/chat/rag-integration', () => ({
  retrieveRAGContext: vi.fn(async () => ''),
  ingestConversationData: vi.fn(async () => {}),
}));
vi.mock('@/src/lib/tokens', () => ({ countTokens: (text: string) => text.length }));

const { POST } = await import('@/src/app/api/chat/route');
const { forkConversationAtMessage } = await import('@/src/lib/server/conversation-fork');

const fetchMock = vi.fn();
const openRouterBodies: Row[] = [];

function post(body: object) {
  return POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest);
}

const seedTurn = (options: { questionId: string; answerId: string; question: string; answer: string; position: number; tool?: { callId: string; result: string } }) => {
  messageRows.set(options.questionId, { id: options.questionId, conversationId: CONVERSATION_ID, role: 'user', content: options.question, modelId: null, position: options.position, createdAt: new Date(1_700_000_000_000 + options.position) });
  messageRows.set(options.answerId, { id: options.answerId, conversationId: CONVERSATION_ID, role: 'assistant', content: options.answer, modelId: MODEL, position: options.position + 1, createdAt: new Date(1_700_000_000_000 + options.position + 1) });
  if (options.tool) {
    toolCallRows.push({
      id: crypto.randomUUID(),
      messageId: options.answerId,
      callId: options.tool.callId,
      position: 0,
      connectionId: 'conn-1',
      toolId: 'echo',
      name: 'Docs__echo',
      arguments: '{"value":"x"}',
      status: 'completed',
      approval: 'approved',
      result: options.tool.result,
      truncated: false,
      error: null,
      createdAt: new Date(),
    });
  }
};

/** The assistant/tool pair as it must appear in an OpenRouter request. */
const expectReplay = (messages: Row[], callId: string, result: string, indexFromEnd: number) => {
  const assistant = messages.at(-indexFromEnd - 2);
  const tool = messages.at(-indexFromEnd - 1);
  expect(assistant).toMatchObject({ role: 'assistant', tool_calls: [{ id: callId }] });
  expect(tool).toEqual({ role: 'tool', content: result, tool_call_id: callId });
};

beforeEach(() => {
  authUserId = 'user-1';
  messageRows.clear();
  toolCallRows.length = 0;
  snapshotRows.clear();
  openRouterBodies.length = 0;
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('MCP_TOOLS', 'off');
  vi.stubGlobal('fetch', fetchMock);
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  db.$queryRaw.mockClear();
  db.$transaction.mockClear();
  messageToolCallTable.createMany.mockClear();
  Object.values(messageTable).forEach((fn) => fn.mockClear());
  Object.values(conversationTable).forEach((fn) => fn.mockClear());
  redis.get.mockReset().mockImplementation(async () => []);
  redis.set.mockReset().mockImplementation(async () => {});
  redis.delete.mockReset().mockImplementation(async () => {});
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.model === 'openai/gpt-5.6-luna') return new Response(JSON.stringify({ choices: [{ message: { content: 'Chat' } }] }));
    openRouterBodies.push(body);
    return sseResponse([delta({ content: 'Fresh answer.' }), '[DONE]']);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('MCP history replay on the next turn', () => {
  it('rebuilds the assistant/tool_calls + tool sequence from saved rows when the cache is empty', async () => {
    seedTurn({ questionId: 'm1', answerId: 'm2', question: 'Look it up', answer: 'Echo said: echo:x', position: 1, tool: { callId: 'call-9', result: 'echo:x' } });

    await readEvents(await post({ message: 'And now?', selectedModel: MODEL, conversationId: CONVERSATION_ID }));

    const sent = openRouterBodies.find((body) => body.model === MODEL)!.messages as Row[];
    const textAt = (message: Row) => (typeof message.content === 'string' ? message.content : '');
    expect(sent.some((message) => message.role === 'user' && textAt(message) === 'Look it up')).toBe(true);
    expectReplay(sent, 'call-9', 'echo:x', 2);
    expect(textAt(sent.at(-1)!)).toContain('And now?');
    // The tool answer sits between its assistant row and the next question.
    expect(sent.findIndex((message) => 'tool_calls' in (message as { tool_calls?: unknown })) + 1)
      .toBe(sent.findIndex((message) => message.role === 'tool'));

    // The refilled cache keeps the calls attached to the assistant entry.
    const cached = redis.set.mock.calls.at(-1)![1] as Array<{ role: string; toolCalls?: unknown[] }>;
    expect(cached.find((message) => message.role === 'assistant')?.toolCalls).toMatchObject([{ callId: 'call-9', status: 'completed' }]);
  });

  it('replays from a warm cache without re-reading rows', async () => {
    redis.get.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Look it up' },
      { id: 'm2', role: 'assistant', content: 'Echo said: echo:x', modelId: MODEL, toolCalls: [{ callId: 'call-9', name: 'Docs__echo', toolId: 'echo', connectionId: 'conn-1', arguments: '{"value":"x"}', status: 'completed', approval: 'approved', result: 'echo:x', truncated: false }] },
    ]);

    await readEvents(await post({ message: 'And now?', selectedModel: MODEL, conversationId: CONVERSATION_ID }));

    const sent = openRouterBodies.find((body) => body.model === MODEL)!.messages as Row[];
    expectReplay(sent, 'call-9', 'echo:x', 2);
    expect(db.message.findMany).not.toHaveBeenCalled();
  });

  it('keeps a tool-free history byte-identical for the provider', async () => {
    redis.get.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Plain question' },
      { id: 'm2', role: 'assistant', content: 'Plain answer', modelId: MODEL },
    ]);
    await readEvents(await post({ message: 'Next', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const sent = openRouterBodies.find((body) => body.model === MODEL)!.messages as Row[];
    expect(sent.some((message) => 'tool_calls' in message)).toBe(false);
    expect(sent.some((message) => message.role === 'tool')).toBe(false);
  });
});

describe('MCP history under retry, compaction and fork', () => {
  it('a retry deletes the replaced tool calls with the turn and does not replay them', async () => {
    seedTurn({ questionId: 'm1', answerId: 'm2', question: 'Look it up', answer: 'Old answer', position: 1, tool: { callId: 'call-9', result: 'echo:x' } });
    redis.get.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Look it up' },
      { id: 'm2', role: 'assistant', content: 'Old answer', modelId: MODEL, toolCalls: [{ callId: 'call-9', name: 'Docs__echo', toolId: 'echo', connectionId: 'conn-1', arguments: '{}', status: 'completed', approval: 'approved', result: 'echo:x', truncated: false }] },
    ]);

    await readEvents(await post({ message: 'Look it up', selectedModel: MODEL, conversationId: CONVERSATION_ID, retry: true }));

    // The prompt was trimmed before the answer: no stale exchange, no tool replay.
    const sent = openRouterBodies.find((body) => body.model === MODEL)!.messages as Row[];
    expect(sent.some((message) => message.role === 'tool')).toBe(false);
    expect(sent.filter((message) => JSON.stringify(message).includes('Look it up'))).toHaveLength(1);

    // The saved exchange was replaced, and its tool rows cascaded away; the
    // replacement (no tools this time) added none.
    expect(messageRows.has('m2')).toBe(false);
    expect(toolCallRows).toHaveLength(0);
    expect([...messageRows.values()].some((row) => row.role === 'assistant' && row.content === 'Fresh answer.')).toBe(true);
  });

  it('compaction: the summarizer sees which tools ran and the kept tail still replays them', async () => {
    vi.stubEnv('CHAT_COMPACTION_MODE', 'on');
    vi.stubEnv('COMPACTION_TRIGGER_MAX_TOKENS', '200');
    vi.stubEnv('COMPACTION_RECENT_EXCHANGES', '2');
    const pad = (word: string) => ' '.repeat(0) + `${word} `.repeat(100);
    const history = [
      { id: 'm1', role: 'user', content: `First question. ${pad('alpha')}`, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: `First answer. ${pad('beta')}`, modelId: MODEL, createdAt: '2026-01-01T00:00:01.000Z', toolCalls: [{ callId: 'call-1', name: 'Docs__echo', toolId: 'echo', connectionId: 'conn-1', arguments: '{"value":"cwnd-doubles"}', status: 'completed', approval: 'approved', result: 'tool fact: cwnd-doubles', truncated: false }] },
      { id: 'm3', role: 'user', content: `Second question. ${pad('gamma')}`, createdAt: '2026-01-01T00:00:02.000Z' },
      { id: 'm4', role: 'assistant', content: `Second answer. ${pad('delta')}`, modelId: MODEL, createdAt: '2026-01-01T00:00:03.000Z', toolCalls: [{ callId: 'call-2', name: 'Docs__echo', toolId: 'echo', connectionId: 'conn-1', arguments: '{}', status: 'denied', approval: 'denied', result: 'The user denied this tool call. Do not try it again.', truncated: false }] },
      { id: 'm5', role: 'user', content: `Third question. ${pad('epsilon')}`, createdAt: '2026-01-01T00:00:04.000Z' },
      { id: 'm6', role: 'assistant', content: `Third answer. ${pad('zeta')}`, modelId: MODEL, createdAt: '2026-01-01T00:00:05.000Z' },
    ];
    redis.get.mockResolvedValue(history);
    const goodSummary = '## Current goal\nx\n## Durable instructions and preferences\nx\n## Established facts\nx\n## Decisions and rationale\nx\n## Unresolved work\nx\n## Exact details\nx';
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === 'openai/gpt-5.6-luna') return new Response(JSON.stringify({ choices: [{ message: { content: 'Chat' } }] }));
      if (body.model === 'openai/gpt-4o-mini') return sseResponse([delta({ content: goodSummary }), '[DONE]']);
      openRouterBodies.push(body);
      return sseResponse([delta({ content: 'Fresh answer.' }), '[DONE]']);
    });

    const events = await readEvents(await post({ message: 'And now?', selectedModel: MODEL, conversationId: CONVERSATION_ID }));

    expect(events).toContainEqual(expect.objectContaining({ contextCompacted: expect.objectContaining({ throughMessageId: 'm2' }) }));
    // The covered region's tool facts reached the summarizer transcript.
    const summaryCall = fetchMock.mock.calls
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
      .find((body) => body.model === 'openai/gpt-4o-mini');
    expect(JSON.stringify(summaryCall)).toContain('Docs__echo (completed): tool fact: cwnd-doubles');

    // The kept tail still replays its assistant/tool sequence verbatim.
    const sent = openRouterBodies.find((body) => body.model === MODEL)!.messages as Row[];
    // tail = [.., m4 assistant(tool_calls), tool(call-2), m5, m6, current user]
    expectReplay(sent, 'call-2', 'The user denied this tool call. Do not try it again.', 4);
    // The compacted (non-kept) tool row is gone from the model view, replaced by the summary.
    expect(sent.some((message) => message.role === 'tool' && (message as { tool_call_id?: string }).tool_call_id === 'call-1')).toBe(false);
    // The transcript itself is untouched: compaction never deletes rows.
    expect(messageToolCallTable.createMany).not.toHaveBeenCalled();
  }, 15_000);

  it('a fork copies the tool calls onto the copied assistant rows, in order', async () => {
    for (const id of messageRows.keys()) messageRows.delete(id);
    toolCallRows.length = 0;
    const row = (id: string, conversationId: string, role: string, content: string, position: number) =>
      messageRows.set(id, { id, conversationId, role, content, modelId: role === 'assistant' ? MODEL : null, position, createdAt: new Date(1_700_000_000_000 + position), updatedAt: new Date(1_700_000_000_000 + position) });
    row('s1', FORK_SOURCE, 'user', 'Look it up', 1);
    row('s2', FORK_SOURCE, 'assistant', 'Echo said hi', 2);
    row('s3', FORK_SOURCE, 'user', 'Again', 3);
    row('s4', FORK_SOURCE, 'assistant', 'Echo again', 4);
    for (const [index, messageId] of ['s2', 's4'].entries()) {
      toolCallRows.push({
        id: crypto.randomUUID(), messageId, callId: `call-${index}`, position: 0, connectionId: 'conn-1', toolId: 'echo',
        name: 'Docs__echo', arguments: '{}', status: 'completed', approval: 'approved', result: `echo-${index}`, truncated: false, error: null, createdAt: new Date(),
      });
    }
    toolCallRows.push({
      id: crypto.randomUUID(), messageId: 's4', callId: 'call-late', position: 1, connectionId: 'conn-1', toolId: 'slow',
      name: 'Docs__slow', arguments: '{}', status: 'denied', approval: 'denied', result: 'no', truncated: false, error: null, createdAt: new Date(),
    });

    const fork = await forkConversationAtMessage('user-1', FORK_SOURCE, 's4');
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;

    const assistantMessages = [...messageRows.values()].filter((item) => item.conversationId === fork.conversation.id && item.role === 'assistant');
    expect(assistantMessages).toHaveLength(2);
    const copied = toolCallRows.filter((item) => assistantMessages.some((message) => message.id === item.messageId));
    // All three source rows are copied (two on the first answer, two on the
    // second, one of which predates the cut but belongs to a kept row).
    expect(copied).toHaveLength(3);
    expect(copied.map((item) => item.callId).sort()).toEqual(['call-0', 'call-1', 'call-late']);
    // Originals still belong to the source conversation.
    expect(toolCallRows.filter((item) => item.messageId === 's2' || item.messageId === 's4')).toHaveLength(3);
    // The client view carries them on the right message, in order.
    const firstCopy = fork.conversation.messages.find((message) => message.content === 'Echo said hi');
    expect(firstCopy?.toolCalls).toMatchObject([{ callId: 'call-0', name: 'Docs__echo', status: 'completed', result: 'echo-0' }]);
    const secondCopy = fork.conversation.messages.find((message) => message.content === 'Echo again');
    expect(secondCopy?.toolCalls?.map((call) => call.callId)).toEqual(['call-1', 'call-late']);
  });
});
