/**
 * Integration test for POST /api/chat with MCP tools on: the real route, the
 * real bounded tool loop, the real approval store and decision endpoint, and a
 * real in-process Streamable HTTP MCP server all run together. Only the edges
 * (auth, Redis, RAG, Prisma and OpenRouter's SSE) are faked, and everything
 * that is not OpenRouter falls through to the real fetch so the fixture
 * traffic is genuine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { delta, readEvents, sseResponse, toolCallArgumentChunks, toolCallDelta } from '../helpers/sse';
import { startMcpFixture, type McpFixture } from '../helpers/mcp-fixture-server';

const nativeFetch = globalThis.fetch;

const auth = vi.fn();
const MODEL = 'openai/gpt-6.1-sol';
const CONVERSATION_ID = '0e7ba32e-05b0-477d-8e30-2bf0a849649e';
const CONNECTION_ID = '11111111-2222-3333-4444-555555555555';

type Row = Record<string, unknown>;
const messageRows = new Map<string, Row & { id: string }>();
const toolCallRows: Row[] = [];
const mcpConnections = new Map<string, Row & { id: string }>();

const conversationTable = {
  create: vi.fn(async ({ data }: { data: Row }) => ({ ...data, title: null })),
  update: vi.fn(async ({ data }: { data: Row }) => ({ ...data })),
  updateMany: vi.fn(async () => ({ count: 1 })),
  findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
};

const toolViewsOf = (messageId: string) =>
  toolCallRows.filter((row) => row.messageId === messageId).sort((a, b) => (a.position as number) - (b.position as number));

const messageTable = {
  findMany: vi.fn(async () =>
    [...messageRows.values()].map((row) => ({ ...row, toolCalls: toolViewsOf(row.id) }))),
  createMany: vi.fn(async ({ data }: { data: Array<Row & { id: string }> }) => {
    for (const row of data) messageRows.set(row.id, { ...row });
    return { count: data.length };
  }),
  findFirst: vi.fn(async () => null),
  deleteMany: vi.fn(async () => {
    // Emulate the FK cascade: dropping a turn takes its tool calls with it.
    const count = messageRows.size;
    messageRows.clear();
    toolCallRows.length = 0;
    return { count };
  }),
  aggregate: vi.fn(async () => ({ _max: { position: null } })),
  count: vi.fn(async () => 0),
};

const db = {
  $queryRaw: vi.fn(async () => []),
  message: messageTable,
  messageToolCall: {
    createMany: vi.fn(async ({ data }: { data: Array<Row> }) => {
      for (const row of data) toolCallRows.push({ id: crypto.randomUUID(), createdAt: new Date(), ...row });
      return { count: data.length };
    }),
  },
  conversation: conversationTable,
  mcpConnection: {
    findMany: vi.fn(async ({ where }: { where: { userId: string; enabled?: boolean; status?: string } }) =>
      [...mcpConnections.values()].filter((row) =>
        row.userId === where.userId &&
        (where.enabled === undefined || row.enabled === where.enabled) &&
        (where.status === undefined || row.status === where.status))),
    count: vi.fn(async () => mcpConnections.size),
  },
  skill: { findMany: vi.fn(async () => []) },
  document: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  $transaction: vi.fn(async (work: (tx: unknown) => unknown) =>
    work({ $queryRaw: db.$queryRaw, message: messageTable, messageToolCall: db.messageToolCall, conversation: conversationTable })),
};

const redis = {
  get: vi.fn<(id: string) => Promise<unknown[]>>(async () => []),
  set: vi.fn<(id: string, messages: unknown[]) => Promise<void>>(async () => {}),
  delete: vi.fn(async () => {}),
  // The approval store falls back to its in-memory backend, like a test run
  // without REDIS_URL.
  isReady: vi.fn(() => false),
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
const { POST: decide } = await import('@/src/app/api/mcp/tool-approvals/route');
const { clearApprovalStore } = await import('@/src/lib/server/tool-approvals');

const fetchMock = vi.fn();
let chatScripts: Array<Array<object | string>> = [];
const openRouterBodies: Row[] = [];

function post(body: object, signal?: AbortSignal) {
  return POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body), signal }) as unknown as NextRequest);
}

const decisionPost = (body: object) =>
  decide(new Request('http://localhost/api/mcp/tool-approvals', { method: 'POST', body: JSON.stringify(body) }));

function seedConnection(url: string) {
  mcpConnections.set(CONNECTION_ID, {
    id: CONNECTION_ID,
    userId: 'user-1',
    name: 'Docs',
    catalogId: null,
    url,
    transport: 'streamable_http',
    authMode: 'none',
    credential: null,
    enabled: true,
    status: 'connected',
    lastError: null,
    lastCheckedAt: new Date(),
    tools: [
      { name: 'docs.search', description: 'Find documentation pages that match a query.', readOnly: true, schemaBytes: 60 },
      { name: 'echo', description: 'Echo the arguments back.', readOnly: false, schemaBytes: 50 },
      { name: 'slow', description: 'Answers late.', readOnly: false, schemaBytes: 20 },
    ],
    toolsDigest: 'digest',
    reviewedDigest: 'digest',
    toolEnabled: { 'docs.search': true, echo: true, slow: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** Streams the response as it arrives so a test can answer mid-turn. */
class Recorder {
  events: Array<Record<string, unknown> | '[DONE]'> = [];
  private ended = false;

  constructor(response: Response) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf('\n\n');
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (block.startsWith('data: ')) {
            const payload = block.slice(6);
            this.events.push(payload === '[DONE]' ? '[DONE]' : JSON.parse(payload));
          }
          cut = buffer.indexOf('\n\n');
        }
      }
      this.ended = true;
    };
    void pump();
  }

  async find(predicate: (event: Record<string, unknown>) => boolean, timeoutMs = 5_000): Promise<Record<string, unknown>> {
    const started = Date.now();
    for (;;) {
      const hit = this.events.find((event) => event !== '[DONE]' && predicate(event as Record<string, unknown>));
      if (hit) return hit as Record<string, unknown>;
      if (Date.now() - started > timeoutMs) throw new Error(`event never arrived; got ${JSON.stringify(this.events)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async finished(timeoutMs = 5_000): Promise<void> {
    const started = Date.now();
    while (!this.ended) {
      if (Date.now() - started > timeoutMs) throw new Error('stream never ended');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

const toolCallScript = (name: string, argsJson: string, callId = 'call-1') => [
  delta({ content: 'Looking it up... ' }),
  toolCallDelta({ index: 0, id: callId, name }),
  ...toolCallArgumentChunks(0, argsJson.match(/.{1,4}/g) ?? []),
  delta({}, 'tool_calls'),
  '[DONE]',
];

const textScript = (text: string) => [delta({ content: text }), '[DONE]'];

const approvalOf = (event: Record<string, unknown>) =>
  event.toolApprovalRequest as { approvalId: string; callId: string; name: string; toolId: string; connectionId: string; arguments: Record<string, unknown>; round: number; expiresAt: number };

let fixture: McpFixture | null = null;

beforeEach(() => {
  messageRows.clear();
  toolCallRows.length = 0;
  mcpConnections.clear();
  openRouterBodies.length = 0;
  chatScripts = [textScript('Plain answer.')];
  clearApprovalStore();
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('MCP_TOOLS', 'off');
  vi.stubEnv('MCP_ALLOWED_ORIGINS', '');
  vi.stubGlobal('fetch', fetchMock);
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  db.$queryRaw.mockClear();
  db.$transaction.mockClear();
  db.messageToolCall.createMany.mockClear();
  db.mcpConnection.findMany.mockClear();
  db.mcpConnection.count.mockClear();
  Object.values(db.message).forEach((fn) => fn.mockClear());
  Object.values(db.conversation).forEach((fn) => fn.mockClear());
  redis.get.mockReset().mockImplementation(async () => []);
  redis.set.mockReset().mockImplementation(async () => {});
  redis.delete.mockReset().mockImplementation(async () => {});
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (!href.includes('openrouter.ai')) return nativeFetch(href, init as RequestInit);
    const body = JSON.parse(init!.body as string);
    if (body.model === 'openai/gpt-5.6-luna') {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Tool chat' } }] }));
    }
    openRouterBodies.push(body);
    return sseResponse(chatScripts.length > 1 ? chatScripts.shift()! : chatScripts[0]!);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await fixture?.close();
  fixture = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/chat with an approved MCP tool call', () => {
  it('offers the allowlisted tools, streams the approval, runs the call and persists it', async () => {
    fixture = await startMcpFixture();
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    chatScripts = [toolCallScript('Docs__echo', '{"value":"hi"}'), textScript('Echo says hi.')];

    const recorder = new Recorder(await post({ message: 'Echo hi', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const requestEvent = await recorder.find((event) => 'toolApprovalRequest' in event);
    const request = approvalOf(requestEvent);
    expect(request).toMatchObject({ callId: 'call-1', name: 'Docs__echo', toolId: 'echo', connectionId: CONNECTION_ID, arguments: { value: 'hi' } });

    const decision = await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'approved' });
    expect(decision.status).toBe(200);

    // Started only arrives after the decision, because the loop pauses for it.
    expect(await recorder.find((event) => 'toolCallStarted' in event)).toMatchObject({
      toolCallStarted: { callId: 'call-1', name: 'Docs__echo' },
    });
    const resultEvent = await recorder.find((event) => 'toolCallResult' in event);
    expect(resultEvent.toolCallResult).toMatchObject({
      callId: 'call-1', name: 'Docs__echo', toolId: 'echo', status: 'completed', approval: 'approved', result: 'echo:hi', truncated: false,
    });
    await recorder.finished();

    // The model was shown the tools, then the exact assistant/tool sequence.
    const offered = openRouterBodies[0].tools as Array<{ function: { name: string } }>;
    expect(offered.map((tool) => tool.function.name)).toEqual(['Docs__docs_search', 'Docs__echo', 'Docs__slow']);
    const replay = openRouterBodies.at(-1)!.messages as Row[];
    expect(replay.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call-1', function: { name: 'Docs__echo', arguments: '{"value":"hi"}' } }],
    });
    expect(replay.at(-1)).toEqual({ role: 'tool', content: 'echo:hi', tool_call_id: 'call-1' });
    expect(fixture.calls).toContain('echo');

    // Persistence: one ordered row attached to the saved assistant turn.
    expect(toolCallRows).toHaveLength(1);
    expect(toolCallRows[0]).toMatchObject({
      callId: 'call-1', name: 'Docs__echo', toolId: 'echo', connectionId: CONNECTION_ID,
      status: 'completed', approval: 'approved', result: 'echo:hi', position: 0,
    });
    const assistant = [...messageRows.values()].find((row) => row.role === 'assistant');
    expect(assistant).toMatchObject({ modelId: MODEL });
    expect(String(assistant!.content).endsWith('Echo says hi.')).toBe(true);
    expect(toolCallRows[0].messageId).toBe(assistant!.id);

    // The cached history carries the calls, so the next turn replays them.
    const cached = redis.set.mock.calls.at(-1)![1] as Array<{ role: string; toolCalls?: unknown[] }>;
    expect(cached.at(-1)).toMatchObject({ role: 'assistant', toolCalls: [{ callId: 'call-1', status: 'completed' }] });

    // No secret-bearing event was sent: the payload never mentions a token.
    expect(JSON.stringify(recorder.events)).not.toContain('Bearer');
  });

  it('denies a call when the user says no, and tells the model visibly', async () => {
    fixture = await startMcpFixture();
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    chatScripts = [toolCallScript('Docs__echo', '{"value":"hi"}'), textScript('As you asked, no lookup.')];

    const recorder = new Recorder(await post({ message: 'Echo hi', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const request = approvalOf(await recorder.find((event) => 'toolApprovalRequest' in event));
    expect((await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'denied' })).status).toBe(200);

    const failure = await recorder.find((event) => 'toolCallFailure' in event);
    expect(failure.toolCallFailure).toMatchObject({ callId: 'call-1', status: 'denied', approval: 'denied' });
    await recorder.finished();

    expect(fixture.calls).toHaveLength(0);
    const toolMessage = (openRouterBodies.at(-1)!.messages as Row[]).at(-1);
    expect(toolMessage).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: expect.stringContaining('denied') });
    expect(toolCallRows[0]).toMatchObject({ status: 'denied', approval: 'denied' });
    // The visible final answer is still saved with the denial.
    expect([...messageRows.values()].some((row) => row.role === 'assistant' && String(row.content).includes('no lookup'))).toBe(true);
  });

  it('refuses a replayed decision after the turn spent it', async () => {
    fixture = await startMcpFixture();
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    chatScripts = [toolCallScript('Docs__echo', '{"value":"hi"}'), textScript('Done.')];

    const recorder = new Recorder(await post({ message: 'Echo hi', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const request = approvalOf(await recorder.find((event) => 'toolApprovalRequest' in event));
    expect((await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'approved' })).status).toBe(200);
    const replay = await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'denied' });
    expect(replay.status).toBe(404);
    // The spent approval cannot undo the approved call.
    await recorder.find((event) => 'toolCallResult' in event);
    await recorder.finished();
    expect(toolCallRows[0]).toMatchObject({ status: 'completed', approval: 'approved' });
  });

  it('refuses another user\'s decision and still honors the owner', async () => {
    fixture = await startMcpFixture();
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    chatScripts = [toolCallScript('Docs__echo', '{"value":"hi"}'), textScript('Done.')];

    const recorder = new Recorder(await post({ message: 'Echo hi', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const request = approvalOf(await recorder.find((event) => 'toolApprovalRequest' in event));

    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'denied' })).status).toBe(403);
    auth.mockResolvedValue({ user: { id: 'user-1' } });
    expect((await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'approved' })).status).toBe(200);

    await recorder.find((event) => 'toolCallResult' in event);
    await recorder.finished();
    expect(toolCallRows[0]).toMatchObject({ status: 'completed', approval: 'approved' });
  });

  it('expires an undecided approval and tells the model the tool was not called', async () => {
    fixture = await startMcpFixture();
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    vi.stubEnv('MCP_APPROVAL_TTL_SECONDS', '1');
    chatScripts = [toolCallScript('Docs__echo', '{"value":"hi"}'), textScript('Nothing ran.')];

    const recorder = new Recorder(await post({ message: 'Echo hi', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const request = approvalOf(await recorder.find((event) => 'toolApprovalRequest' in event));
    const failure = await recorder.find((event) => 'toolCallFailure' in event, 4_000);
    expect(failure.toolCallFailure).toMatchObject({ status: 'timed_out', approval: 'expired' });
    expect(Date.now() - request.expiresAt).toBeLessThan(3_000);
    await recorder.finished();
    expect(fixture.calls).toHaveLength(0);
    const late = await decisionPost({ approvalId: request.approvalId, decision: 'approved' });
    expect([404, 410]).toContain(late.status);
  });

  it('truncates an oversized tool result before the model or the row sees it', async () => {
    fixture = await startMcpFixture({ echoText: 'x'.repeat(40_000) });
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    chatScripts = [toolCallScript('Docs__echo', '{"value":"hi"}'), textScript('Short end.')];

    const recorder = new Recorder(await post({ message: 'Echo hi', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const request = approvalOf(await recorder.find((event) => 'toolApprovalRequest' in event));
    await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'approved' });
    const result = await recorder.find((event) => 'toolCallResult' in event);
    expect(result.toolCallResult).toMatchObject({ status: 'completed', truncated: true });
    await recorder.finished();

    const modelResult = ((openRouterBodies.at(-1)!.messages as Row[]).at(-1) as { content: string }).content;
    expect(modelResult.length).toBeLessThan(20_000);
    expect(modelResult).toContain('[truncated]');
    expect((toolCallRows[0] as { truncated: boolean }).truncated).toBe(true);
  });

  it('cancels the in-flight MCP call when the user stops, and keeps what was written', async () => {
    fixture = await startMcpFixture({ slowMs: 3_000 });
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    chatScripts = [toolCallScript('Docs__slow', '{}')];

    const stop = new AbortController();
    const recorder = new Recorder(await post({ message: 'Take your time', selectedModel: MODEL, conversationId: CONVERSATION_ID }, stop.signal));
    const request = approvalOf(await recorder.find((event) => 'toolApprovalRequest' in event));
    await decisionPost({ approvalId: request.approvalId, conversationId: CONVERSATION_ID, decision: 'approved' });
    await recorder.find((event) => 'toolCallStarted' in event);
    await new Promise((resolve) => setTimeout(resolve, 150));
    stop.abort();
    await recorder.finished(4_000);

    expect(fixture.calls).toContain('slow');
    expect(toolCallRows[0]).toMatchObject({ status: 'cancelled', approval: 'approved' });
    // No second model call: stopping ends the loop.
    expect(openRouterBodies).toHaveLength(1);
    // The prose streamed before the call is still saved with the question.
    expect([...messageRows.values()].some((row) => row.role === 'assistant' && String(row.content).includes('Looking it up'))).toBe(true);
  });

  it('reports a connection that cannot be listed and continues without tools', async () => {
    seedConnection('http://127.0.0.1:9/mcp');
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', 'http://127.0.0.1:9');
    chatScripts = [textScript('No tools needed.')];

    const recorder = new Recorder(await post({ message: 'hello', selectedModel: MODEL, conversationId: CONVERSATION_ID }));
    const failure = await recorder.find((event) => 'toolDiscoveryFailed' in event);
    expect(failure.toolDiscoveryFailed).toMatchObject({ connectionId: CONNECTION_ID });
    expect(String((failure.toolDiscoveryFailed as { error: string }).error).length).toBeGreaterThan(5);
    await recorder.finished();

    expect(openRouterBodies[0]).not.toHaveProperty('tools');
    expect([...messageRows.values()].some((row) => row.role === 'assistant' && row.content === 'No tools needed.')).toBe(true);
  });
});

describe('POST /api/chat keeps the old shape when MCP is not in play', () => {
  const comparable = (events: Array<Record<string, unknown> | '[DONE]'>) =>
    events.map((event) => {
      if (event === '[DONE]') return event;
      // Wall-clock timing and database ids differ per run.
      if ('analytics' in event) {
        const { analytics } = event as { analytics: Record<string, unknown> };
        return { ...event, analytics: { ...analytics, durationMs: 0 } };
      }
      return 'savedMessages' in event ? { ...event, savedMessages: 'fresh-ids' } : event;
    });

  it('produces byte-identical SSE and request bodies with the flag on and no connections', async () => {
    const run = async () => {
      messageRows.clear();
      toolCallRows.length = 0;
      openRouterBodies.length = 0;
      chatScripts = [textScript('Identical answer.')];
      const events = comparable(await readEvents(await post({ message: 'Hello', selectedModel: MODEL, conversationId: CONVERSATION_ID })));
      return { events, bodies: JSON.stringify(openRouterBodies) };
    };

    const off = await run();
    vi.stubEnv('MCP_TOOLS', 'on');
    const on = await run();

    expect(on.events).toEqual(off.events);
    expect(on.bodies).toBe(off.bodies);
    expect(JSON.parse(off.bodies)[0]).not.toHaveProperty('tools');
    expect(toolCallRows).toHaveLength(0);
  });
});

describe('POST /api/chat, council never receives MCP tools', () => {
  it('sends no tools and never loads MCP connections', async () => {
    fixture = await startMcpFixture();
    seedConnection(fixture.url);
    vi.stubEnv('MCP_TOOLS', 'on');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', fixture.origin);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const eventsPromise = readEvents(await post({
        message: 'Compare',
        selectedModel: 'council',
        conversationId: CONVERSATION_ID,
        council: { members: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'], chair: 'anthropic/claude-sonnet-5.5' },
      }));
      await vi.runAllTimersAsync();
      await eventsPromise;
      expect(openRouterBodies.length).toBeGreaterThan(1);
      expect(openRouterBodies.every((body) => !('tools' in body))).toBe(true);
      expect(db.mcpConnection.findMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
