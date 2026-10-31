/**
 * Security regression guard: a signed-in user cannot read or change another
 * user's data through these routes. Each test fixes the query to the session
 * user, so dropping a `userId` scope fails here.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ME = 'user-a';
const OTHER = 'user-b';
const ID = '00000000-0000-4000-8000-000000000000';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  conversation: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  document: { findUnique: vi.fn() },
  scheduledTask: { findFirst: vi.fn() },
  startManualRun: vi.fn(),
  getUserProfile: vi.fn(),
  saveUserProfile: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/src/lib/prisma', () => ({
  prisma: { conversation: mocks.conversation, document: mocks.document, scheduledTask: mocks.scheduledTask },
}));
vi.mock('@/src/lib/redis', () => ({ redisStore: { delete: vi.fn() } }));
vi.mock('@/src/lib/server/scheduled-task-runner', () => ({
  RunInProgressError: class extends Error {},
  startManualRun: mocks.startManualRun,
}));
vi.mock('@/src/services/profile/storage', () => ({
  EXPLANATION_STYLES: ['concise'],
  TECHNICAL_LEVELS: ['expert'],
  getUserProfile: mocks.getUserProfile,
  saveUserProfile: mocks.saveUserProfile,
}));

import { GET as listConversations } from '@/src/app/api/conversations/route';
import { DELETE as deleteConversation } from '@/src/app/api/conversations/[id]/route';
import { POST as checkDocument } from '@/src/app/api/documents/check/route';
import { GET as getProfile, PUT as putProfile } from '@/src/app/api/rag/profile/[userId]/route';
import { POST as runNow } from '@/src/app/api/scheduled-tasks/[id]/run/route';

const json = (body: unknown) =>
  new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: ME }, expires: '2099-01-01' });
  mocks.conversation.findMany.mockResolvedValue([]);
  mocks.conversation.count.mockResolvedValue(0);
  mocks.conversation.findUnique.mockResolvedValue(null);
  mocks.document.findUnique.mockResolvedValue(null);
  mocks.scheduledTask.findFirst.mockResolvedValue(null);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('tenant isolation', () => {
  it('lists and counts only the session user’s conversations', async () => {
    const response = await listConversations(new NextRequest('http://localhost/api/conversations'));
    expect(response.status).toBe(200);
    expect(mocks.conversation.findMany.mock.calls[0][0].where.userId).toBe(ME);
    expect(mocks.conversation.count.mock.calls[0][0].where.userId).toBe(ME);
  });

  it('will not delete a conversation the session user does not own', async () => {
    const response = await deleteConversation(new NextRequest(`http://localhost/api/conversations/${ID}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(404);
    expect(mocks.conversation.findUnique.mock.calls[0][0].where).toEqual({ id: ID, userId: ME });
    expect(mocks.conversation.delete).not.toHaveBeenCalled();
  });

  it('checks document hashes within the session user’s documents only', async () => {
    const sha256 = 'a'.repeat(64);
    const response = await checkDocument(json({ sha256 }));
    expect(await response.json()).toEqual({ document: null });
    expect(mocks.document.findUnique.mock.calls[0][0].where).toEqual({ userId_sha256: { userId: ME, sha256 } });
  });

  it('will not run another user’s scheduled task', async () => {
    const response = await runNow(new Request(`http://localhost/api/scheduled-tasks/${ID}/run`, { method: 'POST' }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(404);
    expect(mocks.scheduledTask.findFirst.mock.calls[0][0].where).toMatchObject({ id: ID, userId: ME });
    expect(mocks.startManualRun).not.toHaveBeenCalled();
  });

  it('refuses to read or write another user’s profile', async () => {
    const params = Promise.resolve({ userId: OTHER });
    expect((await getProfile(new NextRequest('http://localhost/api'), { params })).status).toBe(403);
    expect((await putProfile(json({ explanationStyle: 'concise' }), { params })).status).toBe(403);
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
    expect(mocks.saveUserProfile).not.toHaveBeenCalled();
  });
});
