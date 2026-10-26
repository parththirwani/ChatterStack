import React, { useState, useCallback, useMemo, memo } from 'react';
import type { User } from '@/src/types/user.types';
import type { Conversation } from '@/src/types/conversation.types';
import ChatHistory from '@/src/components/sidebar/history/ChatHistory';
import NewChatDraft from '@/src/components/sidebar/history/NewChatDraft';
import SidebarActionButtons from '@/src/components/sidebar/actions/SidebarActionButton';
import SidebarHeader from '@/src/components/sidebar/header/SidebarHeader';
import UserSection from '@/src/components/sidebar/user/UserSection';
import { useAppStore } from '@/src/store/rootStore';
import { sortConversations } from '@/src/store/slices/conversations/conversationSlice';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user?: User | null;
  onUserChange?: (user: User | null) => void; // Optional now
  onConversationSelect?: (conversationId: string) => void;
  onNewChat?: () => void;
  currentConversationId?: string;
  refreshTrigger?: number;
  onLoginClick?: () => void;
  onLogoutClick?: () => void;
  /** Server-rendered list, used until the client store is hydrated. */
  initialConversations?: Conversation[];
}

const SidebarOptimized: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  user = null,
  onConversationSelect,
  onNewChat,
  currentConversationId,
  onLoginClick,
  onLogoutClick,
  initialConversations,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const storedConversations = useAppStore((state) => state.conversations);
  const conversationsHydrated = useAppStore((state) => state.conversationsHydrated);
  // Ids of chats still generating, as a string so the selector stays stable
  // between stream flushes.
  const streamingKey = useAppStore((state) =>
    Object.keys(state.chatState)
      .filter((id) => id !== 'new' && state.chatState[id]?.loading)
      .join(',')
  );
  const streamingIds = useMemo(() => new Set(streamingKey ? streamingKey.split(',') : []), [streamingKey]);
  const conversationsLoading = useAppStore((state) => state.conversationsLoading);
  const deleteConversation = useAppStore((state) => state.deleteConversation);

  // The server list is the first paint; after hydration the store is the
  // source of truth (so logout/login don't flash stale chat titles).
  const conversations = conversationsHydrated
    ? storedConversations
    : initialConversations?.length
      ? initialConversations
      : storedConversations;

  // Reads the active chat from the store rather than closing over the prop:
  // this callback goes to every row, so depending on the active id would
  // re-render the whole list on each chat switch.
  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      const wasActive = useAppStore.getState().currentConversationId === conversationId;
      await deleteConversation(conversationId);
      if (wasActive && onNewChat) {
        onNewChat();
      }
    },
    [onNewChat, deleteConversation]
  );

  const handleNewChat = useCallback(() => {
    if (onNewChat) onNewChat();
  }, [onNewChat]);

  const handleConversationClick = useCallback(
    (conversationId: string) => {
      if (onConversationSelect) onConversationSelect(conversationId);
    },
    [onConversationSelect]
  );

  const handleLoginClick = useCallback(() => {
    if (onLoginClick) onLoginClick();
  }, [onLoginClick]);

  const handleLogoutClick = useCallback(() => {
    if (onLogoutClick) onLogoutClick();
  }, [onLogoutClick]);

  const filteredChats = useMemo(() => {
    const sorted = sortConversations(conversations);
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sorted;

    return sorted.filter((chat) => {
      if (chat.title?.toLowerCase().includes(query)) return true;
      return chat.messages?.some((message) =>
        message.content?.toLowerCase().includes(query)
      );
    });
  }, [conversations, searchQuery]);

  const isAuthenticated = user && user.id && user.id !== 'guest';

  return (
    <div
      className={`
        ${collapsed ? 'w-16' : 'w-72'}
        h-dvh 
        shrink-0 
        transition-all duration-300 ease-in-out 
        flex flex-col 
        bg-[#151515]
        border-r border-white/[0.07]
        overflow-hidden
      `}
    >
      {/* Header */}
      <div className={`${collapsed ? 'px-2 py-4' : 'px-4 py-4'}`}>
        <SidebarHeader collapsed={collapsed} onToggleCollapse={onToggleCollapse} onNewChat={handleNewChat} />
      </div>

      {/* Action Buttons */}
      <div className={`${collapsed ? 'px-2' : 'px-4'} pb-4`}>
        <SidebarActionButtons
          collapsed={collapsed}
          isAuthenticated={!!isAuthenticated}
          searchQuery={searchQuery}
          onNewChat={handleNewChat}
          onSearchChange={setSearchQuery}
        />
      </div>

      {!collapsed && isAuthenticated && <div className="mx-4 h-px bg-white/[0.06]" />}

      {/* Chat History OR Spacer */}
      {!collapsed && isAuthenticated ? (
        <div className="flex-1 overflow-y-auto min-h-0 px-2">
          <NewChatDraft onOpen={handleNewChat} isOpen={currentConversationId === undefined} />
          <ChatHistory
            loadingConversations={conversationsLoading}
            chats={filteredChats}
            streamingIds={streamingIds}
            searchQuery={searchQuery}
            currentConversationId={currentConversationId}
            onConversationClick={handleConversationClick}
            onDeleteConversation={handleDeleteConversation}
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* User Section */}
      <div className={`${collapsed ? 'p-2' : 'p-4'} shrink-0`}>
        <UserSection
          user={user}
          collapsed={collapsed}
          isAuthenticated={!!isAuthenticated}
          onLoginClick={handleLoginClick}
          onLogoutClick={handleLogoutClick}
        />
      </div>
    </div>
  );
};

export default memo(SidebarOptimized);
