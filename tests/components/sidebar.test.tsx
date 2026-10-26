import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Conversation } from '@/src/types/conversation.types';

const updateConversation = vi.fn();
const getConversation = vi.fn<(id: string) => Promise<unknown>>(async () => null);
vi.mock('@/src/services/api', () => ({
  ApiService: {
    updateConversation: (...args: unknown[]) => updateConversation(...args),
    getConversation: (id: string) => getConversation(id),
  },
}));

const { default: ConversationItem } = await import('@/src/components/sidebar/history/ConversationItem');
const { default: ChatHistory } = await import('@/src/components/sidebar/history/ChatHistory');
const { useAppStore } = await import('@/src/store/rootStore');

const conv = (id: string, title?: string, pinnedAt: string | null = null, firstMessage?: string): Conversation => ({
  id,
  title,
  pinnedAt,
  userId: 'u1',
  createdAt: '2026-10-26T09:00:00Z',
  updatedAt: '2026-10-26T09:00:00Z',
  messages: firstMessage ? [{ id: 'm1', role: 'user', content: firstMessage, timestamp: '2026-10-26T09:00:00Z' } as never] : [],
});

const nextFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

function renderItem(conversation: Conversation, props: Partial<React.ComponentProps<typeof ConversationItem>> = {}) {
  const handlers = {
    onClick: vi.fn(),
    onDelete: vi.fn(async () => {}),
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
  };
  const user = userEvent.setup();
  render(<ConversationItem conversation={conversation} isActive={false} isStreaming={false} {...handlers} {...props} />);
  return { user, ...handlers };
}

describe('conversation item', () => {
  it('opens the chat on click and marks the active one', async () => {
    const { user, onClick } = renderItem(conv('c1', 'TCP Congestion Control'), { isActive: true });
    const title = screen.getByRole('button', { name: 'TCP Congestion Control' });
    expect(title).toHaveAttribute('aria-current', 'page');
    await user.click(title);
    expect(onClick).toHaveBeenCalledWith('c1');
  });

  it('falls back to the first message, then "New chat", until a title arrives', () => {
    const { unmount } = render(
      <ConversationItem conversation={conv('c1', undefined, null, 'Explain TCP')} isActive={false} isStreaming={false}
        onClick={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onTogglePin={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Explain TCP' })).toBeInTheDocument();
    unmount();
    renderItem(conv('c2'));
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
  });

  it('shows the orb and announces "generating" while the chat streams', () => {
    renderItem(conv('c1', 'Live'), { isStreaming: true });
    expect(screen.getByRole('button', { name: 'Live, generating' })).toBeInTheDocument();
    expect(screen.getByTestId('orb')).toBeInTheDocument();
  });

  it('shows no orb once the answer is done', () => {
    renderItem(conv('c1', 'Done'));
    expect(screen.queryByTestId('orb')).toBeNull();
  });

  it('has an actions menu with Pin, Rename and Delete', async () => {
    const { user } = renderItem(conv('c1', 'Chat'));
    const trigger = screen.getByRole('button', { name: 'Actions for Chat' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Chat actions' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Pin', 'Rename', 'Delete']);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Pin' })).toHaveFocus();
  });

  it('pins from the menu', async () => {
    const { user, onTogglePin } = renderItem(conv('c1', 'Chat'));
    await user.click(screen.getByRole('button', { name: 'Actions for Chat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(onTogglePin).toHaveBeenCalledWith('c1', true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers Unpin for a pinned chat', async () => {
    const { user, onTogglePin } = renderItem(conv('c1', 'Chat', '2026-10-26T09:00:00Z'));
    await user.click(screen.getByRole('button', { name: 'Actions for Chat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Unpin' }));
    expect(onTogglePin).toHaveBeenCalledWith('c1', false);
  });

  it('moves through the menu with arrow keys and closes on Escape, returning focus', async () => {
    const { user } = renderItem(conv('c1', 'Chat'));
    const trigger = screen.getByRole('button', { name: 'Actions for Chat' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await nextFrame();
    expect(trigger).toHaveFocus();
  });

  it('closes the menu on an outside click', async () => {
    const { user } = renderItem(conv('c1', 'Chat'));
    await user.click(screen.getByRole('button', { name: 'Actions for Chat' }));
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renames inline from the menu with Enter', async () => {
    const { user, onRename } = renderItem(conv('c1', 'Old title'));
    await user.click(screen.getByRole('button', { name: 'Actions for Old title' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByRole('textbox', { name: 'Chat title' });
    expect(input).toHaveValue('Old title');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('maxLength', '80');

    await user.clear(input);
    await user.type(input, '  New title  {Enter}');
    expect(onRename).toHaveBeenCalledWith('c1', 'New title');
    expect(screen.queryByRole('textbox')).toBeNull();
    await nextFrame();
    expect(screen.getByRole('button', { name: 'Old title' })).toHaveFocus();
  });

  it('renames on double-click and saves on blur', async () => {
    const { user, onRename } = renderItem(conv('c1', 'Old'));
    await user.dblClick(screen.getByRole('button', { name: 'Old' }));
    const input = screen.getByRole('textbox', { name: 'Chat title' });
    await user.clear(input);
    await user.type(input, 'Blurred');
    act(() => input.blur());
    expect(onRename).toHaveBeenCalledWith('c1', 'Blurred');
  });

  it('cancels a rename with Escape', async () => {
    const { user, onRename } = renderItem(conv('c1', 'Keep me'));
    await user.dblClick(screen.getByRole('button', { name: 'Keep me' }));
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), ' changed{Escape}');
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Keep me' })).toBeInTheDocument();
  });

  it.each([
    ['an empty title', '   '],
    ['an unchanged title', 'Same'],
  ])('ignores %s', async (_label, value) => {
    const { user, onRename } = renderItem(conv('c1', 'Same'));
    await user.dblClick(screen.getByRole('button', { name: 'Same' }));
    const input = screen.getByRole('textbox', { name: 'Chat title' });
    await user.clear(input);
    await user.type(input, `${value}{Enter}`);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('asks before deleting', async () => {
    const { user, onDelete } = renderItem(conv('c1', 'Doomed'));
    await user.click(screen.getByRole('button', { name: 'Actions for Doomed' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete conversation' });
    expect(dialog).toHaveTextContent('"Doomed"');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('c1');
  });
});

describe('chat history', () => {
  const noop = vi.fn();

  beforeEach(() => {
    updateConversation.mockReset();
    useAppStore.setState({ conversations: [], chatState: {} });
  });

  function renderHistory(chats: Conversation[], streamingIds = new Set<string>()) {
    return render(
      <ChatHistory loadingConversations={false} chats={chats} streamingIds={streamingIds}
        onConversationClick={noop} onDeleteConversation={async () => {}} />
    );
  }

  it('shows a Pinned section above the other chats', () => {
    renderHistory([conv('p', 'Pinned one', '2026-10-26T09:00:00Z'), conv('a', 'Recent one'), conv('b', 'Older one')]);
    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Pinned chats', 'Chats']);
    expect(within(sections[0]).getAllByRole('listitem')).toHaveLength(1);
    expect(within(sections[0]).getByRole('button', { name: 'Pinned one' })).toBeInTheDocument();
    expect(within(sections[1]).getAllByRole('button', { name: /^(Recent|Older) one$/ }).map((b) => b.textContent)).toEqual(['Recent one', 'Older one']);
  });

  it('has no Pinned section when nothing is pinned', () => {
    renderHistory([conv('a', 'Recent one')]);
    expect(screen.queryByRole('region', { name: 'Pinned chats' })).toBeNull();
  });

  it('marks only streaming chats', () => {
    renderHistory([conv('a', 'Streaming'), conv('b', 'Idle')], new Set(['a']));
    expect(screen.getByRole('button', { name: 'Streaming, generating' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Idle' })).toBeInTheDocument();
    expect(screen.getAllByTestId('orb')).toHaveLength(1);
  });

  it('saves pin and rename through the store', async () => {
    useAppStore.setState({ conversations: [conv('a', 'Chat')] });
    updateConversation.mockResolvedValue({ id: 'a', title: 'Renamed', pinnedAt: '2026-10-26T09:00:00.000Z' });
    const user = userEvent.setup();
    renderHistory([conv('a', 'Chat')]);

    await user.click(screen.getByRole('button', { name: 'Actions for Chat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(updateConversation).toHaveBeenCalledWith('a', { pinned: true });

    await user.dblClick(screen.getByRole('button', { name: 'Chat' }));
    const input = screen.getByRole('textbox', { name: 'Chat title' });
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    expect(updateConversation).toHaveBeenCalledWith('a', { title: 'Renamed' });
  });

  it('prefetches a chat on hover or focus so opening it is instant', async () => {
    getConversation.mockResolvedValue(null);
    const user = userEvent.setup();
    renderHistory([conv('a', 'Chat A')]);
    await user.hover(screen.getByRole('button', { name: 'Chat A' }));
    expect(getConversation).toHaveBeenCalledWith('a');
  });

  it('shows empty and no-match states', () => {
    const { rerender } = renderHistory([]);
    expect(screen.getByText('No chats yet')).toBeInTheDocument();
    rerender(<ChatHistory loadingConversations={false} chats={[]} streamingIds={new Set()} searchQuery="zzz"
      onConversationClick={noop} onDeleteConversation={async () => {}} />);
    expect(screen.getByText('No matching chats')).toBeInTheDocument();
  });
});

describe('double-click rename on a chat that is not open', () => {
  it('survives the sidebar remounting when the first click opens the chat', async () => {
    const user = userEvent.setup();
    const props = { isActive: false, isStreaming: false, onClick: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(), onTogglePin: vi.fn() };
    const { unmount } = render(<ConversationItem conversation={conv('c1', 'Old')} {...props} />);
    await user.dblClick(screen.getByRole('button', { name: 'Old' }));
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), ' and new');

    // Navigation remounts the sidebar with the chat now active.
    unmount();
    render(<ConversationItem conversation={conv('c1', 'Old')} {...props} isActive />);
    const input = screen.getByRole('textbox', { name: 'Chat title' });
    expect(input).toHaveValue('Old and new');
    expect(input).toHaveFocus();
    await user.type(input, '{Enter}');
    expect(props.onRename).toHaveBeenCalledWith('c1', 'Old and new');
  });
});
