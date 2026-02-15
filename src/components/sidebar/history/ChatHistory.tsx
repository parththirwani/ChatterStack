import React, { memo } from 'react';
import { MessageSquare, Loader2, AlertCircle } from 'lucide-react';
import { Conversation } from '@/src/types/conversation.types';
import ConversationItem from './ConversationItem';
import { useAppStore } from '@/src/store/rootStore';
import { OptimisticChat } from '@/src/lib/api/chat/optimistic-chat-manager';

interface ChatHistoryProps {
  loadingConversations: boolean;
  filteredConversations?: Conversation[];
  currentConversationId?: string;
  onConversationClick: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  formatDate: (date: string) => string;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  loadingConversations,
  filteredConversations,
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
      <div className="px-2 mb-2">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Conversations
        </h3>
      </div>

      {loadingConversations ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
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
                  <div className="absolute top-2 right-3 flex items-center gap-1">
                    {chat.status === 'generating' || chat.status === 'streaming' ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                        <Loader2 className="w-2.5 h-2.5 text-yellow-500 animate-spin" />
                        <span className="text-xs text-yellow-400 font-medium">
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
        <div className="text-center py-12 px-4">
          <div className="w-12 h-12 rounded-full bg-gray-800/50 flex items-center justify-center mx-auto mb-3">
            <MessageSquare className="w-6 h-6 text-gray-500" />
          </div>
          <p className="text-sm text-gray-400 mb-1">No conversations yet</p>
          <p className="text-xs text-gray-500">
            Start chatting to see your history
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