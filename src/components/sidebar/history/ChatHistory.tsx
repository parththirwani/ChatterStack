import React, { memo, useMemo } from 'react';
import { MessageSquare, Loader2, AlertCircle } from 'lucide-react';
import { Conversation } from '@/src/types/conversation.types';

import ConversationItem from './ConversationItem';
import { useAppStore } from '@/src/store/rootStore';
import { OptimisticChat } from '@/src/lib/api/chat/optimistic-chat-manager';

interface ChatHistoryProps {
  loadingConversations: boolean;
  currentConversationId?: string;
  onConversationClick: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  formatDate: (date: string) => string;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  loadingConversations,
  currentConversationId,
  onConversationClick,
  onDeleteConversation,
  formatDate,
}) => {
  // Get merged list of real + optimistic chats
  const getAllChatsForSidebar = useAppStore((state) => state.getAllChatsForSidebar);
  const allChats = getAllChatsForSidebar();

  // Determine if a chat is optimistic
  const isOptimistic = (chat: Conversation | OptimisticChat): chat is OptimisticChat => {
    return 'isOptimistic' in chat && chat.isOptimistic === true;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
        Recent Chats
      </h3>
      {loadingConversations ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : allChats.length > 0 ? (
        <div className="space-y-3">
          {allChats.slice(0, 20).map((chat) => {
            const optimistic = isOptimistic(chat);
            const chatId = optimistic ? (chat.realId || chat.tempId) : chat.id;
            
            // Use tempId for key to ensure uniqueness during transition
            const uniqueKey = optimistic ? chat.tempId : chat.id;
            
            const isActive = currentConversationId === chatId || 
                           (optimistic && currentConversationId === chat.tempId);

            return (
              <div key={uniqueKey} className="relative">
                <MemoizedConversationItem
                  conversation={chat as Conversation}
                  isActive={isActive}
                  onClick={() => onConversationClick(chatId)}
                  onDelete={() => onDeleteConversation(chatId)}
                  formatDate={formatDate}
                />
                
                {/* Streaming/Status Indicator */}
                {optimistic && (
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    {chat.status === 'generating' || chat.status === 'streaming' ? (
                      <>
                        <Loader2 className="w-3 h-3 text-yellow-500 animate-spin" />
                      </>
                    ) : chat.status === 'error' ? (
                      <>
                        <AlertCircle className="w-3 h-3 text-red-500" />
                        <span className="text-xs text-red-500">Error</span>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8">
          <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">No conversations yet</p>
          <p className="text-gray-500 text-xs">
            Start a new chat to see it here
          </p>
        </div>
      )}
    </div>
  );
};

// Memoize ConversationItem to prevent unnecessary re-renders
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
  return (
    prev.loadingConversations === next.loadingConversations &&
    prev.currentConversationId === next.currentConversationId
  );
});