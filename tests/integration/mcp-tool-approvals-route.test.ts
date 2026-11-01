import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.fn();
vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));

const { POST: decide } = await import('@/src/app/api/mcp/tool-approvals/route');
const {
  cancelApproval,
  clearApprovalStore,
  collectDecision,
  createApproval,
  getApproval,
  waitForDecision,
} = await import('@/src/lib/server/tool-approvals');

const post = (body: unknown) =>
  new Request('http://localhost/api/mcp/tool-approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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
  clearApprovalStore();
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('the tool approval decision endpoint', () => {
  it('requires a session and a well-formed body', async () => {
    auth.mockResolvedValue(null);
    expect((await decide(post({ approvalId: 'aaaaaaaa-aaaa', decision: 'approved' }))).status).toBe(401);
    auth.mockResolvedValue({ user: { id: 'user-1' } });
    expect((await decide(post({ approvalId: 'x', decision: 'approved' }))).status).toBe(400);
    expect((await decide(post({ approvalId: 'aaaaaaaa-aaaa', decision: 'maybe' }))).status).toBe(400);
  });

  it('records the owner\'s decision exactly once', async () => {
    const approval = await pending();
    const first = await decide(post({ approvalId: approval.id, conversationId: 'conv-1', decision: 'approved' }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, decision: 'approved' });
    expect(await collectDecision(approval.id)).toBe('approved');

    const replay = await decide(post({ approvalId: approval.id, decision: 'denied' }));
    expect(replay.status).toBe(404);
    expect(await collectDecision(approval.id)).toBeNull();
  });

  it('refuses another user and leaves the pending call for its owner', async () => {
    const approval = await pending();
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    const stolen = await decide(post({ approvalId: approval.id, decision: 'approved' }));
    expect(stolen.status).toBe(403);
    expect(await getApproval(approval.id)).not.toBeNull();
    expect(await collectDecision(approval.id)).toBeNull();

    auth.mockResolvedValue({ user: { id: 'user-1' } });
    expect((await decide(post({ approvalId: approval.id, decision: 'denied' }))).status).toBe(200);
    expect(await collectDecision(approval.id)).toBe('denied');
  });

  it('refuses a decision aimed at somebody else\'s conversation', async () => {
    const approval = await pending();
    const wrong = await decide(post({ approvalId: approval.id, conversationId: 'conv-other', decision: 'approved' }));
    expect(wrong.status).toBe(403);
    expect(await getApproval(approval.id)).not.toBeNull();
  });

  it('reports an unknown or expired approval instead of accepting it', async () => {
    expect((await decide(post({ approvalId: 'never-seen-id', decision: 'approved' }))).status).toBe(404);
    const stale = await createApproval(
      { userId: 'user-1', conversationId: 'conv-1', callId: 'call-old', connectionId: 'conn-1', toolId: 'conn-1/echo', name: 'docs__echo', arguments: {}, round: 1 },
      -1
    );
    expect(await getApproval(stale.id)).toBeNull();
    expect((await decide(post({ approvalId: stale.id, decision: 'approved' }))).status).toBe(404);
  });

  it('hands the decision to whoever is waiting for it', async () => {
    const approval = await pending();
    const waiting = waitForDecision(approval, { signal: new AbortController().signal, timeoutMs: 2_000, pollMs: 20 });
    const response = await decide(post({ approvalId: approval.id, decision: 'approved' }));
    expect(response.status).toBe(200);
    expect(await waiting).toBe('approved');
  });

  it('gives up and clears the pending call when the user stops the turn', async () => {
    const approval = await pending();
    const controller = new AbortController();
    const waiting = waitForDecision(approval, { signal: controller.signal, timeoutMs: 2_000, pollMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    controller.abort();
    expect(await waiting).toBe('cancelled');
    expect(await getApproval(approval.id)).toBeNull();
    expect((await decide(post({ approvalId: approval.id, decision: 'approved' }))).status).toBe(404);
  });

  it('expires a call nobody decided', async () => {
    const approval = await pending();
    const waiting = waitForDecision(approval, { signal: new AbortController().signal, timeoutMs: 120, pollMs: 20 });
    expect(await waiting).toBe('expired');
    expect(await getApproval(approval.id)).toBeNull();
  });

  it('ends a cancelled approval immediately', async () => {
    const approval = await pending();
    await cancelApproval(approval.id);
    expect(await getApproval(approval.id)).toBeNull();
  });
});
