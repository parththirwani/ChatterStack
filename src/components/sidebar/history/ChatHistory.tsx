import React, { memo } from 'react';
import { MessageSquare } from 'lucide-react';
import { Conversation } from '@/src/types/conversation.types';
import ConversationItem from './ConversationItem';

interface ChatHistoryProps {
  loadingConversations: boolean;
  filteredConversations: Conversation[];
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
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
        Recent Chats
      </h3>
      {loadingConversations ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : filteredConversations.length > 0 ? (
        <div className="space-y-3">
          {filteredConversations.slice(0, 20).map((conversation) => (
            <MemoizedConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={currentConversationId === conversation.id}
              onClick={() => onConversationClick(conversation.id)}
              onDelete={() => onDeleteConversation(conversation.id)}
              formatDate={formatDate}
            />
          ))}
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
    prev.currentConversationId === next.currentConversationId &&
    prev.filteredConversations.length === next.filteredConversations.length &&
    prev.filteredConversations === next.filteredConversations // Reference equality check
  );
});