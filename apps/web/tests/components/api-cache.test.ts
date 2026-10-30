/** Mutations must invalidate exactly the cached responses they change. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '@/src/services/api';
import { apiOptimizer, cacheInvalidators } from '@/src/services/apiOptimizer';

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  apiOptimizer.invalidateCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return json({ conversation: { id: 'c1', title: 'New', pinnedAt: null } });
    if (init?.method === 'DELETE') return json({});
    if (url === '/api/conversations') return json({ conversations: [] });
    if (url === '/api/conversations/missing') return json({ error: 'not found' }, 404);
    if (url === '/api/conversations/broken') return json({ error: 'boom' }, 500);
    return json({ conversation: { id: url.split('/').pop(), messages: [] } });
  });
});

const getCalls = (url: string) => fetchMock.mock.calls.filter(([u, init]) => u === url && !init?.method).length;

describe('conversation cache', () => {
  it('renaming refetches that chat and the list, but not other chats', async () => {
    await ApiService.getConversations();
    await ApiService.getConversation('c1');
    await ApiService.getConversation('c2');
    await ApiService.updateConversation('c1', { title: 'New' });

    await ApiService.getConversations();
    await ApiService.getConversation('c1');
    await ApiService.getConversation('c2');
    expect(getCalls('/api/conversations')).toBe(2);
    expect(getCalls('/api/conversations/c1')).toBe(2);
    expect(getCalls('/api/conversations/c2')).toBe(1);
  });

  it('deleting a chat drops it and the list from the cache', async () => {
    await ApiService.getConversations();
    await ApiService.getConversation('c1');
    await ApiService.deleteConversation('c1');
    await ApiService.getConversations();
    await ApiService.getConversation('c1');
    expect(getCalls('/api/conversations')).toBe(2);
    expect(getCalls('/api/conversations/c1')).toBe(2);
  });

  it('the list invalidator leaves single chats cached', async () => {
    await ApiService.getConversation('c1');
    cacheInvalidators.conversationList();
    await ApiService.getConversation('c1');
    expect(getCalls('/api/conversations/c1')).toBe(1);
  });
});

describe('getConversation', () => {
  it('returns null only when the chat does not exist', async () => {
    await expect(ApiService.getConversation('missing')).resolves.toBeNull();
  });

  it('throws on other failures, so they are not shown as "not available"', async () => {
    await expect(ApiService.getConversation('broken')).rejects.toThrow('HTTP 500');
  });
});
