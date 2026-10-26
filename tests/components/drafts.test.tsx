/**
 * A separate unsent draft per chat: kept when switching chats, restored after
 * a reload, shown in the sidebar until it's sent.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Conversation } from '@/src/types/conversation.types';

const deleteConversation = vi.fn(async () => {});
vi.mock('@/src/services/api', () => ({
  ApiService: {
    deleteConversation: () => deleteConversation(),
    getConversation: vi.fn(async () => null),
    updateConversation: vi.fn(),
  },
}));

const { useAppStore } = await import('@/src/store/rootStore');
const { useComposerDraft } = await import('@/src/hooks/useComposerDraft');
const { default: ConversationItem } = await import('@/src/components/sidebar/history/ConversationItem');
const { default: NewChatDraft } = await import('@/src/components/sidebar/history/NewChatDraft');

const me = { id: 'u1', name: 'Me', email: 'me@example.com', avatarUrl: null };
const drafts = () => useAppStore.getState().drafts;

beforeEach(() => {
  useAppStore.setState({ user: me, drafts: {}, draftsOwner: null, draftsHydrated: true, conversations: [], chatState: {}, conversationsHydrated: false });
});
afterEach(() => vi.useRealTimers());

describe('draft store', () => {
  it('keeps text per chat and drops empty or whitespace drafts', () => {
    const { setDraft } = useAppStore.getState();
    setDraft('a', 'Hello A');
    setDraft('new', 'Hello new chat');
    expect(drafts()).toEqual({ a: 'Hello A', new: 'Hello new chat' });
    expect(useAppStore.getState().draftsOwner).toBe('u1');

    setDraft('a', '   ');
    expect(drafts()).toEqual({ new: 'Hello new chat' });
  });

  it('does not notify subscribers when nothing changed', () => {
    useAppStore.getState().setDraft('a', 'Same');
    const listener = vi.fn();
    const unsubscribe = useAppStore.subscribe(listener);
    useAppStore.getState().setDraft('a', 'Same');
    useAppStore.getState().setDraft('b', '');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('is saved with the rest of the persisted settings', async () => {
    await useAppStore.persist.rehydrate();
    useAppStore.getState().setDraft('a', 'Keep me');
    const saved = JSON.parse(localStorage.getItem('chatterstack-storage')!);
    expect(saved.state).toMatchObject({ drafts: { a: 'Keep me' }, draftsOwner: 'u1' });
  });

  it('is not overwritten by store updates made before the saved state is read', async () => {
    localStorage.setItem('chatterstack-storage', JSON.stringify({ state: { drafts: { a: 'Saved earlier' }, draftsOwner: 'u1', sidebarCollapsed: true }, version: 0 }));
    // e.g. the page syncing the open chat from the URL on mount, before hydration.
    vi.spyOn(useAppStore.persist, 'hasHydrated').mockReturnValue(false);
    useAppStore.getState().setCurrentConversationId('b');
    vi.mocked(useAppStore.persist.hasHydrated).mockRestore();

    await useAppStore.persist.rehydrate();
    expect(drafts()).toEqual({ a: 'Saved earlier' });
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
  });

  it('writes to localStorage only when a persisted field changes, not on every store update', async () => {
    await useAppStore.persist.rehydrate();
    useAppStore.getState().setDraft('a', 'Draft');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    // A streaming reply updates the store ~25 times a second.
    for (let i = 0; i < 50; i++) {
      useAppStore.getState().setChatState('c1', { messages: [{ id: 'm', role: 'assistant', content: 'x'.repeat(i) }], loading: true });
    }
    expect(setItem).not.toHaveBeenCalled();

    useAppStore.getState().setDraft('a', 'Draft, edited');
    useAppStore.getState().setSidebarCollapsed(!useAppStore.getState().sidebarCollapsed);
    expect(setItem).toHaveBeenCalledTimes(2);
    setItem.mockRestore();
  });

  it("drops another account's drafts when a different user signs in", () => {
    useAppStore.setState({ drafts: { a: 'Theirs' }, draftsOwner: 'someone-else' });
    useAppStore.getState().hydrateSession({ user: me, conversations: [] });
    expect(drafts()).toEqual({});
  });

  it('keeps your own drafts when the session is restored', () => {
    useAppStore.setState({ drafts: { a: 'Mine' }, draftsOwner: 'u1' });
    useAppStore.getState().hydrateSession({ user: me, conversations: [] });
    expect(drafts()).toEqual({ a: 'Mine' });
  });

  it('clears drafts on sign-out and for a deleted chat', async () => {
    useAppStore.setState({ drafts: { a: 'A', b: 'B' }, draftsOwner: 'u1' });
    await useAppStore.getState().deleteConversation('a');
    expect(drafts()).toEqual({ b: 'B' });
    useAppStore.getState().reset();
    expect(drafts()).toEqual({});
  });
});

describe('composer draft', () => {
  it('saves what you type after a short pause', () => {
    vi.useFakeTimers();
    const { result } = renderHook(({ id }) => useComposerDraft(id), { initialProps: { id: 'a' } });
    act(() => result.current.setMessage('Half a thought'));
    expect(drafts().a).toBeUndefined();
    act(() => vi.advanceTimersByTime(300));
    expect(drafts().a).toBe('Half a thought');
  });

  it('keeps a separate draft per chat when switching', () => {
    const { result, rerender } = renderHook(({ id }) => useComposerDraft(id), { initialProps: { id: 'a' } });
    act(() => result.current.setMessage('Draft for A'));

    rerender({ id: 'b' });
    // Saved immediately on switch, not after the pause.
    expect(drafts().a).toBe('Draft for A');
    expect(result.current.message).toBe('');

    act(() => result.current.setMessage('Draft for B'));
    rerender({ id: 'a' });
    expect(result.current.message).toBe('Draft for A');
    expect(drafts().b).toBe('Draft for B');
  });

  it('keeps the new-chat draft apart from existing chats', () => {
    useAppStore.setState({ drafts: { new: 'Fresh idea', a: 'Reply to A' } });
    const { result, rerender } = renderHook(({ id }) => useComposerDraft(id), { initialProps: { id: 'new' } });
    expect(result.current.message).toBe('Fresh idea');
    rerender({ id: 'a' });
    expect(result.current.message).toBe('Reply to A');
  });

  it('drops the draft once the message is sent', () => {
    const { result } = renderHook(() => useComposerDraft('a'));
    act(() => result.current.setMessage('Sending this'));
    act(() => result.current.clearDraft());
    expect(result.current.message).toBe('');
    expect(drafts().a).toBeUndefined();
  });

  it('restores drafts that load from storage after mount', () => {
    useAppStore.setState({ draftsHydrated: false });
    const { result } = renderHook(() => useComposerDraft('a'));
    expect(result.current.message).toBe('');
    act(() => useAppStore.setState({ drafts: { a: 'From last session' }, draftsHydrated: true }));
    expect(result.current.message).toBe('From last session');
  });

  it('does not let a late restore overwrite what you already typed', () => {
    useAppStore.setState({ draftsHydrated: false });
    const { result } = renderHook(() => useComposerDraft('a'));
    act(() => result.current.setMessage('Typed already'));
    act(() => useAppStore.setState({ drafts: { a: 'Old' }, draftsHydrated: true }));
    expect(result.current.message).toBe('Typed already');
  });
});

const conv = (id: string, title: string): Conversation => ({
  id, title, pinnedAt: null, userId: 'u1', createdAt: '2026-10-26T09:00:00Z', updatedAt: '2026-10-26T09:00:00Z', messages: [],
});
const itemProps = { isStreaming: false, onClick: vi.fn(), onDelete: vi.fn(async () => {}), onRename: vi.fn(), onTogglePin: vi.fn() };

describe('drafts in the sidebar', () => {
  it('shows an unsent draft under the chat title', () => {
    useAppStore.setState({ drafts: { a: 'What about\n  fast   recovery?' } });
    render(<ConversationItem conversation={conv('a', 'TCP')} isActive={false} {...itemProps} />);
    const row = screen.getByRole('button', { name: /^TCP/ });
    expect(row).toHaveTextContent('Draft');
    expect(row).toHaveTextContent('What about fast recovery?');
    expect(row).toHaveAccessibleName(/TCP\s*,? unsent draft/);
  });

  it("doesn't repeat the draft for the chat you're in", () => {
    useAppStore.setState({ drafts: { a: 'Typing here' } });
    render(<ConversationItem conversation={conv('a', 'TCP')} isActive {...itemProps} />);
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('updates when the draft is sent', () => {
    useAppStore.setState({ drafts: { a: 'Soon sent' } });
    render(<ConversationItem conversation={conv('a', 'TCP')} isActive={false} {...itemProps} />);
    act(() => useAppStore.getState().setDraft('a', ''));
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('lists an unsent new chat that opens the new-chat page', async () => {
    useAppStore.setState({ drafts: { new: 'An idea for later' } });
    const onOpen = vi.fn();
    const { rerender } = render(<NewChatDraft isOpen={false} onOpen={onOpen} />);
    const row = screen.getByRole('region', { name: 'Unsent new chat' });
    expect(row).toHaveTextContent('New chat');
    expect(row).toHaveTextContent('An idea for later');
    await userEvent.setup().click(screen.getByRole('button', { name: /New chat/ }));
    expect(onOpen).toHaveBeenCalled();

    rerender(<NewChatDraft isOpen onOpen={onOpen} />);
    expect(screen.queryByRole('region', { name: 'Unsent new chat' })).toBeNull();
  });

  it('shows nothing without a new-chat draft', () => {
    const { container } = render(<NewChatDraft isOpen={false} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
