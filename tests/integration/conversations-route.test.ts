/**
 * Integration tests for the conversation API: rename, pin/unpin, ordering and
 * ownership checks, running the real route handlers against a faked Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const auth = vi.fn();
const db = {
  conversation: {
    findFirst: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  skill: { findMany: vi.fn() },
};

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));

const byId = await import('@/src/app/api/conversations/[id]/route');
const list = await import('@/src/app/api/conversations/route');

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  byId.PATCH(
    new Request(`http://localhost/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }) as unknown as NextRequest,
    params(id)
  );

const pinnedAt = new Date('2026-10-26T09:00:00.000Z');
const updatedAt = new Date('2026-10-26T09:00:01.000Z');

beforeEach(() => {
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  Object.values(db.conversation).forEach((fn) => fn.mockReset());
  db.conversation.findFirst.mockResolvedValue({ updatedAt });
  db.conversation.update.mockResolvedValue({ id: 'c1', title: 'Renamed', pinnedAt: null, updatedAt });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('PATCH /api/conversations/[id]', () => {
  it('renames a chat the user owns', async () => {
    const response = await patch('c1', { title: '  Renamed  ' });
    expect(response.status).toBe(200);
    expect(db.conversation.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'user-1' }, select: { updatedAt: true } });
    expect(db.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1', userId: 'user-1' },
      data: { title: 'Renamed', updatedAt },
    }));
    expect((await response.json()).conversation.title).toBe('Renamed');
  });

  it('pins with a timestamp and returns it', async () => {
    db.conversation.update.mockResolvedValue({ id: 'c1', title: 'T', pinnedAt, updatedAt });
    const response = await patch('c1', { pinned: true });
    const { data } = db.conversation.update.mock.calls[0][0];
    expect(data.pinnedAt).toBeInstanceOf(Date);
    expect((await response.json()).conversation.pinnedAt).toBe(pinnedAt.toISOString());
  });

  it('unpins by clearing the timestamp', async () => {
    await patch('c1', { pinned: false });
    expect(db.conversation.update.mock.calls[0][0].data).toEqual({ pinnedAt: null, updatedAt });
  });

  it('can rename and pin in one request', async () => {
    await patch('c1', { title: 'Both', pinned: true });
    expect(db.conversation.update.mock.calls[0][0].data).toMatchObject({ title: 'Both', pinnedAt: expect.any(Date) });
  });

  it('does not count a rename or pin as activity, so the chat keeps its place', async () => {
    await patch('c1', { title: 'Renamed', pinned: true });
    expect(db.conversation.update.mock.calls[0][0].data.updatedAt).toBe(updatedAt);
  });

  it.each([
    ['an empty title', { title: '   ' }],
    ['a title over 80 characters', { title: 'x'.repeat(81) }],
    ['a non-boolean pin', { pinned: 'yes' }],
    ['an empty update', {}],
  ])('rejects %s', async (_label, body) => {
    expect((await patch('c1', body)).status).toBe(400);
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("returns 404 for someone else's chat without changing it", async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    expect((await patch('not-mine', { title: 'Hijack' })).status).toBe(404);
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    auth.mockResolvedValue(null);
    expect((await patch('c1', { title: 'x' })).status).toBe(401);
  });
});

describe('GET /api/conversations', () => {
  it('lists pinned chats first, then by recent activity, including pinnedAt', async () => {
    db.conversation.findMany.mockResolvedValue([
      { id: 'p', title: 'Pinned', pinnedAt, userId: 'user-1', createdAt: updatedAt, updatedAt, messages: [] },
    ]);
    db.conversation.count.mockResolvedValue(1);

    const response = await list.GET(new Request('http://localhost/api/conversations') as unknown as NextRequest);
    const query = db.conversation.findMany.mock.calls[0][0];

    // Scheduled task runs are listed on their task's page, not in Recents.
    expect(query.where).toEqual({ userId: 'user-1', scheduledTaskId: null });
    expect(query.orderBy).toEqual([{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }]);
    expect((await response.json()).conversations[0].pinnedAt).toBe(pinnedAt.toISOString());
  });
});

describe('GET /api/conversations/[id]', () => {
  it('includes pinnedAt', async () => {
    db.conversation.findFirst.mockResolvedValue({
      id: 'c1', title: 'T', pinnedAt, userId: 'user-1', createdAt: updatedAt, updatedAt, messages: [],
    });
    const response = await byId.GET(new Request('http://localhost/api/conversations/c1') as unknown as NextRequest, params('c1'));
    expect(db.conversation.findFirst.mock.calls[0][0].where).toEqual({ id: 'c1', userId: 'user-1' });
    expect((await response.json()).conversation.pinnedAt).toBe(pinnedAt.toISOString());
  });

  it('returns tagged skills and marks deleted ones as removed', async () => {
    db.conversation.findFirst.mockResolvedValue({
      id: 'c1', title: 'T', pinnedAt: null, userId: 'user-1', createdAt: updatedAt, updatedAt, messages: [{
        id: 'm1', role: 'user', content: 'Hi', modelId: null, createdAt: updatedAt, updatedAt,
        skills: [{ id: 's1', name: 'kept' }, { id: 's2', name: 'deleted' }],
      }],
    });
    db.skill.findMany.mockResolvedValue([{ id: 's1' }]);
    const response = await byId.GET(new Request('http://localhost/api/conversations/c1') as unknown as NextRequest, params('c1'));
    expect(db.skill.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1', id: { in: ['s1', 's2'] } }, select: { id: true } });
    expect((await response.json()).conversation.messages[0].skills).toEqual([
      { id: 's1', name: 'kept', removed: false },
      { id: 's2', name: 'deleted', removed: true },
    ]);
  });

  it("returns 404 for someone else's chat", async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    const response = await byId.GET(new Request('http://localhost/api/conversations/x') as unknown as NextRequest, params('x'));
    expect(response.status).toBe(404);
  });
});

describe('list and single-chat shapes', () => {
  it('match each other (one shared serializer for API and server render)', async () => {
    const row = {
      id: 'c1', title: null, pinnedAt: null, userId: 'user-1', createdAt: updatedAt, updatedAt,
      messages: [{ id: 'm1', role: 'user', content: 'Hi', modelId: null, createdAt: updatedAt, updatedAt }],
    };
    db.conversation.findMany.mockResolvedValue([row]);
    db.conversation.count.mockResolvedValue(1);
    db.conversation.findFirst.mockResolvedValue(row);

    const [fromList] = (await (await list.GET(new Request('http://localhost/api/conversations') as unknown as NextRequest)).json()).conversations;
    const { conversation } = await (await byId.GET(new Request('http://localhost/api/conversations/c1') as unknown as NextRequest, params('c1'))).json();
    const { getChatPageData } = await import('@/src/lib/server/chat-data');
    const ssr = await getChatPageData('c1');

    expect(fromList).toEqual(conversation);
    expect(ssr.initialConversation).toEqual(conversation);
    expect(conversation).toEqual({
      id: 'c1', pinnedAt: null, parentConversationId: null, forkedFromMessageId: null, scheduledTaskId: null, userId: 'user-1', createdAt: updatedAt.toISOString(), updatedAt: updatedAt.toISOString(),
      messages: [{ id: 'm1', role: 'user', content: 'Hi', createdAt: updatedAt.toISOString(), updatedAt: updatedAt.toISOString() }],
    });
  });
});
