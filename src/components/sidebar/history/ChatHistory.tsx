import React, { memo } from 'react';
import { MessageSquare, Loader2, AlertCircle, Search } from 'lucide-react';
import { Conversation } from '@/src/types/conversation.types';
import ConversationItem from './ConversationItem';
import { useAppStore } from '@/src/store/rootStore';
import { OptimisticChat } from '@/src/lib/api/chat/optimistic-chat-manager';

interface ChatHistoryProps {
  loadingConversations: boolean;
  filteredConversations?: Conversation[];
  searchQuery?: string;
  currentConversationId?: string;
  onConversationClick: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  formatDate: (date: string) => string;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  loadingConversations,
  filteredConversations,
  searchQuery = '',
  currentConversationId,
  onConversationClick,
  onDeleteConversation,
  formatDate,
}) => {
  const getAllChatsForSidebar = useAppStore((state) => state.getAllChatsForSidebar);
  const allChats = filteredConversations || getAllChatsForSidebar();

  const isOptimistic = (chat: Conversation | OptimisticChat): chat is OptimisticChat => {
    return 'isOptimistic' in chat && chat.isOptimistic === true;
  };

  return (
    <div className="py-3">
      {/* Section label - subtle */}
      <div className="px-2 pb-2 pt-1">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a8681]">
          Chats
        </h3>
      </div>

      {loadingConversations ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-4 w-4 animate-spin text-[#8f8b86]" />
        </div>
      ) : allChats.length > 0 ? (
        <div className="space-y-1">
          {allChats.slice(0, 20).map((chat) => {
            const optimistic = isOptimistic(chat);
            const chatId = optimistic ? (chat.realId || chat.tempId) : chat.id;
            const uniqueKey = optimistic ? chat.tempId : chat.id;
            const isActive = currentConversationId === chatId || 
                           (optimistic && currentConversationId === chat.tempId);

            return (
              <div key={uniqueKey} className="relative px-2">
                <MemoizedConversationItem
                  conversation={chat as Conversation}
                  isActive={isActive}
                  onClick={() => onConversationClick(chatId)}
                  onDelete={() => onDeleteConversation(chatId)}
                  formatDate={formatDate}
                />
                
                {/* Streaming indicator - minimal badge */}
                {optimistic && (
                  <div className="absolute right-10 top-2 flex items-center gap-1">
                    {chat.status === 'generating' || chat.status === 'streaming' ? (
                      <div className="flex items-center gap-1 rounded-full border border-white/[0.12] bg-white/[0.06] px-2 py-0.5">
                        <Loader2 className="h-2.5 w-2.5 animate-spin text-[#d8d4ce]" />
                        <span className="text-[11px] font-medium text-[#d8d4ce]">
                          {chat.status === 'generating' ? 'Thinking' : 'Typing'}
                        </span>
                      </div>
                    ) : chat.status === 'error' ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
                        <AlertCircle className="w-2.5 h-2.5 text-red-500" />
                        <span className="text-xs text-red-400 font-medium">Error</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
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
            {searchQuery.trim()
              ? 'Try a different search term'
              : 'Start a conversation to see it here'}
          </p>
        </div>
      )}
    </div>
  );
};

const MemoizedConversationItem = memo(ConversationItem, (prev, next) => {
  return (
    prev.conversation.id === next.conversation.id &&
    prev.conversation.title === next.conversation.title &&
    prev.conversation.updatedAt === next.conversation.updatedAt &&
    prev.isActive === next.isActive
  );
});

MemoizedConversationItem.displayName = 'MemoizedConversationItem';

export default memo(ChatHistory, (prev, next) => {
  if (prev.filteredConversations && next.filteredConversations) {
    return (
      prev.loadingConversations === next.loadingConversations &&
      prev.currentConversationId === next.currentConversationId &&
      prev.filteredConversations.length === next.filteredConversations.length
    );
  }
  
  return (
    prev.loadingConversations === next.loadingConversations &&
    prev.currentConversationId === next.currentConversationId
  );
});