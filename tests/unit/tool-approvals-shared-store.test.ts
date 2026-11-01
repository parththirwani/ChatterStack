import { beforeEach, describe, expect, it, vi } from 'vitest';

// A Redis that is configured but not connected yet, like a fresh route bundle:
// the approval store has to connect before it writes, otherwise the pending
// record lands in this process's memory and the decision request (a different
// bundle, or another instance) can never find it.
const redis = vi.hoisted(() => {
  const store = new Map<string, string>();
  const state = { ready: false, configured: true, connectCalls: 0, connectFails: false };
  const redisStore = {
    isReady: () => state.ready,
    hasConfiguration: () => state.configured,
    connect: async () => {
      state.connectCalls += 1;
      if (!state.connectFails) state.ready = true;
    },
    getKey: async (key: string) => store.get(key) ?? null,
    setKey: async (key: string, value: string) => {
      store.set(key, value);
    },
    deleteKey: async (key: string) => store.delete(key),
    evalScript: async (_script: string, options: { keys: string[] }) => {
      const value = store.get(options.keys[0]) ?? null;
      if (value) store.delete(options.keys[0]);
      return value;
    },
  };
  return { store, state, redisStore };
});

vi.mock('@/src/lib/redis', () => ({ redisStore: redis.redisStore }));

const { clearApprovalStore, collectDecision, createApproval, getApproval, submitDecision } = await import(
  '@/src/lib/server/tool-approvals'
);

const pending = () =>
  createApproval({
    userId: 'user-1',
    conversationId: 'conv-1',
    callId: 'call-1',
    connectionId: 'conn-1',
    toolId: 'conn-1/echo',
    name: 'docs__echo',
    arguments: { value: 'hi' },
    round: 1,
  });

beforeEach(() => {
  redis.store.clear();
  redis.state.ready = false;
  redis.state.configured = true;
  redis.state.connectCalls = 0;
  redis.state.connectFails = false;
  clearApprovalStore();
});

describe('the approval store when Redis is configured', () => {
  it('connects on first use and keeps the pending record in the shared store', async () => {
    const approval = await pending();

    expect(redis.state.connectCalls).toBe(1);
    expect(redis.store.has(`mcp:approval:${approval.id}`)).toBe(true);
    // A decision arriving in another process/bundle reads the same key.
    expect(await submitDecision({ id: approval.id, userId: 'user-1', conversationId: 'conv-1', decision: 'approved' })).toBe(
      'recorded'
    );
    expect(redis.store.has(`mcp:decision:${approval.id}`)).toBe(true);
    expect(await collectDecision(approval.id)).toBe('approved');
  });

  it('falls back to process memory when Redis is not configured', async () => {
    redis.state.configured = false;

    const approval = await pending();

    expect(redis.state.connectCalls).toBe(0);
    expect(redis.store.size).toBe(0);
    expect((await getApproval(approval.id))?.id).toBe(approval.id);
    expect(await submitDecision({ id: approval.id, userId: 'user-1', decision: 'denied' })).toBe('recorded');
    expect(await collectDecision(approval.id)).toBe('denied');
  });

  it('attempts a failing Redis once, then serves the memory fallback without retrying every call', async () => {
    redis.state.connectFails = true;

    const first = await pending();
    const second = await pending();

    expect(redis.state.connectCalls).toBe(1);
    expect((await getApproval(first.id))?.id).toBe(first.id);
    expect((await getApproval(second.id))?.id).toBe(second.id);
    expect(redis.store.size).toBe(0);
  });
});
