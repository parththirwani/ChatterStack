import React, { memo, useCallback } from 'react';
import { MessageSquare, Loader2, Search } from 'lucide-react';
import { Conversation } from '@/src/types/conversation.types';
import ConversationItem from './ConversationItem';
import { useAppStore } from '@/src/store/rootStore';

interface ChatHistoryProps {
  loadingConversations: boolean;
  /** Already sorted: pinned first, then by activity. */
  chats: Conversation[];
  streamingIds: Set<string>;
  searchQuery?: string;
  currentConversationId?: string;
  onConversationClick: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2 pb-2 pt-1">
    <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a8681]">{children}</h3>
  </div>
);

const ChatHistory: React.FC<ChatHistoryProps> = ({
  loadingConversations,
  chats,
  streamingIds,
  searchQuery = '',
  currentConversationId,
  onConversationClick,
  onDeleteConversation,
}) => {
  const renameConversation = useAppStore((state) => state.renameConversation);
  const setConversationPinned = useAppStore((state) => state.setConversationPinned);
  const fetchConversation = useAppStore((state) => state.fetchConversation);

  const handleRename = useCallback(
    (id: string, title: string) => {
      renameConversation(id, title).catch((error) => console.error('Failed to rename chat:', error));
    },
    [renameConversation]
  );

  const handlePrefetch = useCallback(
    (id: string) => {
      fetchConversation(id).catch(() => {});
    },
    [fetchConversation]
  );

  const handleTogglePin = useCallback(
    (id: string, pinned: boolean) => {
      setConversationPinned(id, pinned).catch((error) => console.error('Failed to pin chat:', error));
    },
    [setConversationPinned]
  );

  const pinned = chats.filter((chat) => chat.pinnedAt);
  const recent = chats.filter((chat) => !chat.pinnedAt);

  const renderList = (list: Conversation[]) => (
    <ul className="space-y-1 px-2">
      {list.map((chat) => (
        <li key={chat.id}>
          <ConversationItem
            conversation={chat}
            isActive={currentConversationId === chat.id}
            isStreaming={streamingIds.has(chat.id)}
            onClick={onConversationClick}
            onDelete={onDeleteConversation}
            onRename={handleRename}
            onTogglePin={handleTogglePin}
            onPrefetch={handlePrefetch}
          />
        </li>
      ))}
    </ul>
  );

  if (loadingConversations && chats.length === 0) {
    return (
      <div className="py-3">
        <SectionLabel>Recents</SectionLabel>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-4 w-4 animate-spin text-[#8f8b86]" />
        </div>
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="py-3">
        <SectionLabel>Recents</SectionLabel>
        <div className="px-4 py-12 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04]">
            {searchQuery.trim() ? (
              <Search className="h-4 w-4 text-[#8f8b86]" strokeWidth={1.8} />
            ) : (
              <MessageSquare className="h-5 w-5 text-[#8f8b86]" strokeWidth={1.6} />
            )}
          </div>
          <p className="mb-1 text-[13px] text-[#b3afa9]">
            {searchQuery.trim() ? 'No matching chats' : 'No chats yet'}
          </p>
          <p className="text-xs text-[#8f8b86]">
            {searchQuery.trim() ? 'Try a different search term' : 'Start a conversation to see it here'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-3">
      {pinned.length > 0 && (
        <section aria-label="Pinned chats" className="mb-4">
          <SectionLabel>Pinned</SectionLabel>
          {renderList(pinned)}
        </section>
      )}
      {recent.length > 0 && (
        <section aria-label="Recents">
          <SectionLabel>Recents</SectionLabel>
          {renderList(recent)}
        </section>
      )}
    </div>
  );
};

export default memo(ChatHistory);
