import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/src/types/conversation.types';

const updateConversation = vi.fn();
const getConversation = vi.fn<(id: string) => Promise<unknown>>(async () => null);
const forkConversation = vi.fn<(id: string, messageId: string) => Promise<Conversation>>(
  async () => { throw new Error('no fork response configured'); }
);
vi.mock('@/src/services/api', () => ({
  ApiService: {
    updateConversation: (...args: unknown[]) => updateConversation(...args),
    getConversation: (id: string) => getConversation(id),
    forkConversation: (id: string, messageId: string) => forkConversation(id, messageId),
  },
}));

const { useAppStore } = await import('@/src/store/rootStore');
const { sortConversations } = await import('@/src/store/slices/conversations/conversationSlice');

const conv = (id: string, updatedAt: string, pinnedAt: string | null = null, title?: string): Conversation => ({
  id,
  title,
  pinnedAt,
  userId: 'u1',
  createdAt: updatedAt,
  updatedAt,
  messages: [],
});

const user = { id: 'u1', name: 'Test', email: 't@example.com', avatarUrl: null };

beforeEach(() => {
  updateConversation.mockReset();
  useAppStore.setState({ conversations: [], conversationsHydrated: false, user: null, userHydrated: false, chatState: {} });
});

describe('sortConversations', () => {
  it('puts pinned chats first, most recently pinned on top, then by activity', () => {
    const sorted = sortConversations([
      conv('old', '2026-10-01T00:00:00Z'),
      conv('pinned-early', '2026-09-01T00:00:00Z', '2026-10-02T00:00:00Z'),
      conv('new', '2026-10-20T00:00:00Z'),
      conv('pinned-late', '2026-08-01T00:00:00Z', '2026-10-10T00:00:00Z'),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['pinned-late', 'pinned-early', 'new', 'old']);
  });
});

describe('renameConversation', () => {
  it('updates the title immediately and keeps it when the server agrees', async () => {
    useAppStore.setState({ conversations: [conv('c1', '2026-10-01T00:00:00Z', null, 'Old')] });
    let resolve!: (value: unknown) => void;
    updateConversation.mockReturnValue(new Promise((r) => (resolve = r)));

    const pending = useAppStore.getState().renameConversation('c1', 'New');
    expect(useAppStore.getState().conversations[0].title).toBe('New');
    resolve({ id: 'c1', title: 'New', pinnedAt: null });
    await pending;

    expect(updateConversation).toHaveBeenCalledWith('c1', { title: 'New' });
    expect(useAppStore.getState().conversations[0].title).toBe('New');
  });

  it('reverts the title if the server rejects the rename', async () => {
    useAppStore.setState({ conversations: [conv('c1', '2026-10-01T00:00:00Z', null, 'Old')] });
    updateConversation.mockRejectedValue(new Error('500'));
    await expect(useAppStore.getState().renameConversation('c1', 'New')).rejects.toThrow('500');
    expect(useAppStore.getState().conversations[0].title).toBe('Old');
  });

  it('does nothing when the title is unchanged', async () => {
    useAppStore.setState({ conversations: [conv('c1', '2026-10-01T00:00:00Z', null, 'Same')] });
    await useAppStore.getState().renameConversation('c1', 'Same');
    expect(updateConversation).not.toHaveBeenCalled();
  });
});

describe('setConversationPinned', () => {
  it('pins immediately and then adopts the server timestamp', async () => {
    useAppStore.setState({ conversations: [conv('c1', '2026-10-01T00:00:00Z')] });
    updateConversation.mockResolvedValue({ id: 'c1', pinnedAt: '2026-10-26T09:00:00.000Z' });

    const pending = useAppStore.getState().setConversationPinned('c1', true);
    expect(useAppStore.getState().conversations[0].pinnedAt).toBeTruthy();
    await pending;

    expect(updateConversation).toHaveBeenCalledWith('c1', { pinned: true });
    expect(useAppStore.getState().conversations[0].pinnedAt).toBe('2026-10-26T09:00:00.000Z');
  });

  it('unpins', async () => {
    useAppStore.setState({ conversations: [conv('c1', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')] });
    updateConversation.mockResolvedValue({ id: 'c1', pinnedAt: null });
    await useAppStore.getState().setConversationPinned('c1', false);
    expect(useAppStore.getState().conversations[0].pinnedAt).toBeNull();
  });

  it('reverts if the server rejects the pin', async () => {
    useAppStore.setState({ conversations: [conv('c1', '2026-10-01T00:00:00Z')] });
    updateConversation.mockRejectedValue(new Error('404'));
    await expect(useAppStore.getState().setConversationPinned('c1', true)).rejects.toThrow('404');
    expect(useAppStore.getState().conversations[0].pinnedAt).toBeNull();
  });
});

describe('hydrateSession', () => {
  it('seeds the list on first load', () => {
    useAppStore.getState().hydrateSession({ user, conversations: [conv('a', '2026-10-01T00:00:00Z')] });
    expect(useAppStore.getState().conversations.map((c) => c.id)).toEqual(['a']);
  });

  it('does not wipe chats created on the client when ChatPage re-sends an older server payload', () => {
    useAppStore.getState().hydrateSession({ user, conversations: [] });
    // A new chat was started and is streaming; it only exists client-side so far.
    useAppStore.getState().addConversation(conv('streaming', '2026-10-26T09:00:00Z'));
    useAppStore.getState().updateConversation('streaming', { title: 'Live title' });

    // Navigating /<id> -> / remounts ChatPage, which hydrates again with its stale first payload.
    useAppStore.getState().hydrateSession({ user, conversations: [conv('server-only', '2026-10-01T00:00:00Z')] });

    const list = useAppStore.getState().conversations;
    expect(list.map((c) => c.id)).toEqual(['streaming', 'server-only']);
    expect(list[0].title).toBe('Live title');
  });

  it('replaces the list when a different user signs in', () => {
    useAppStore.getState().hydrateSession({ user, conversations: [conv('mine', '2026-10-01T00:00:00Z')] });
    useAppStore.getState().hydrateSession({ user: { ...user, id: 'u2' }, conversations: [conv('theirs', '2026-10-01T00:00:00Z')] });
    expect(useAppStore.getState().conversations.map((c) => c.id)).toEqual(['theirs']);
  });
});

describe('fetchConversation', () => {
  const full = (id: string) => ({
    conversation: {
      ...conv(id, '2026-10-01T00:00:00Z', null, 'Loaded'),
      messages: [
        { id: 'm2', role: 'assistant', content: 'Answer', createdAt: '2026-10-01T00:00:02Z' },
        { id: 'm1', role: 'user', content: 'Question', createdAt: '2026-10-01T00:00:01Z' },
      ],
    },
  });

  beforeEach(() => {
    getConversation.mockReset();
    useAppStore.setState({ missingConversationIds: {} });
  });

  it('loads messages in order', async () => {
    getConversation.mockResolvedValue(full('c1'));
    await useAppStore.getState().fetchConversation('c1');
    expect(useAppStore.getState().chatState.c1.messages.map((m) => m.content)).toEqual(['Question', 'Answer']);
    expect(useAppStore.getState().chatState.c1.loading).toBe(false);
  });

  it('shares one request between a hover prefetch and the click', async () => {
    getConversation.mockResolvedValue(full('c1'));
    await Promise.all([useAppStore.getState().fetchConversation('c1'), useAppStore.getState().fetchConversation('c1')]);
    await useAppStore.getState().fetchConversation('c1');
    expect(getConversation).toHaveBeenCalledTimes(1);
  });

  it('never replaces messages already in memory (a visited or streaming chat)', async () => {
    useAppStore.getState().setChatState('c1', { messages: [{ id: 'live', role: 'assistant', content: 'Streaming…' }], loading: true });
    await useAppStore.getState().fetchConversation('c1');
    expect(getConversation).not.toHaveBeenCalled();
    expect(useAppStore.getState().chatState.c1.messages[0].content).toBe('Streaming…');
  });

  it('treats a network or server failure as a retryable error, not a missing chat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getConversation.mockRejectedValueOnce(new Error('HTTP 500'));
    await useAppStore.getState().fetchConversation('c1');
    expect(useAppStore.getState().missingConversationIds.c1).toBeUndefined();
    expect(useAppStore.getState().chatState.c1.error).toMatch(/Couldn't load this conversation/);

    // Opening it again retries, and success clears the error.
    getConversation.mockResolvedValueOnce(full('c1'));
    await useAppStore.getState().fetchConversation('c1');
    expect(useAppStore.getState().chatState.c1.error).toBeUndefined();
    expect(useAppStore.getState().chatState.c1.messages).toHaveLength(2);
  });

  it('marks a chat the API does not return as missing, and retries later', async () => {
    getConversation.mockResolvedValue(null);
    await useAppStore.getState().fetchConversation('gone');
    expect(useAppStore.getState().missingConversationIds.gone).toBe(true);

    getConversation.mockResolvedValue(full('gone'));
    await useAppStore.getState().fetchConversation('gone');
    expect(useAppStore.getState().missingConversationIds.gone).toBeUndefined();
    expect(useAppStore.getState().chatState.gone.messages).toHaveLength(2);
  });
});

describe('forkConversation', () => {
  const source = conv('source', '2026-10-20T09:00:00Z', null, 'Caching plan');
  const fork = (): Conversation => ({
    ...conv('fork', '2026-10-26T09:00:00Z', null, 'Fork of Caching plan'),
    parentConversationId: 'source',
    forkedFromMessageId: 'm3',
    forkSource: { id: 'source', title: 'Caching plan' },
    // Deliberately out of order: the store has to read it the way the server does.
    messages: [
      { id: 'f2', role: 'assistant', content: 'It defers writes.', position: 2, createdAt: '2026-10-20T09:00:01Z' },
      { id: 'f1', role: 'user', content: 'How does caching work?', position: 1, createdAt: '2026-10-20T09:00:00Z' },
    ],
  });

  beforeEach(() => {
    forkConversation.mockReset();
    useAppStore.setState({ currentConversationId: undefined, chatState: {}, drafts: {} });
  });

  it('opens the copy in Recents without disturbing the chat it came from', async () => {
    // The source has an answer streaming and a draft typed into its composer.
    useAppStore.setState({
      conversations: [source],
      currentConversationId: 'source',
      chatState: { source: { messages: [{ id: 'live', role: 'assistant', content: 'Streaming…' }], loading: true, councilProgress: [] } },
      drafts: { source: 'half-typed question' },
    });
    forkConversation.mockResolvedValue(fork());

    const conversation = await useAppStore.getState().forkConversation('source', 'm3');

    expect(forkConversation).toHaveBeenCalledWith('source', 'm3');
    expect(conversation.id).toBe('fork');

    const state = useAppStore.getState();
    expect(state.conversations.map((item) => item.id)).toEqual(['fork', 'source']);
    expect(state.currentConversationId).toBe('fork');
    expect(state.conversations[0].forkSource).toEqual({ id: 'source', title: 'Caching plan' });
    expect(state.chatState.fork.messages.map((message) => message.content)).toEqual([
      'How does caching work?',
      'It defers writes.',
    ]);
    expect(state.chatState.source).toMatchObject({ loading: true, messages: [{ id: 'live' }] });
    expect(state.drafts.source).toBe('half-typed question');

    useAppStore.getState().removeConversation('source');
    expect(useAppStore.getState().conversations[0].forkSource).toBeNull();
  });

  it('creates nothing locally when the server refuses', async () => {
    useAppStore.setState({ conversations: [source], currentConversationId: 'source' });
    forkConversation.mockRejectedValueOnce(new Error('Conversation not found'));

    await expect(useAppStore.getState().forkConversation('source', 'nope')).rejects.toThrow('Conversation not found');

    const state = useAppStore.getState();
    expect(state.conversations.map((item) => item.id)).toEqual(['source']);
    expect(state.currentConversationId).toBe('source');
    expect(state.chatState.fork).toBeUndefined();
  });
});
