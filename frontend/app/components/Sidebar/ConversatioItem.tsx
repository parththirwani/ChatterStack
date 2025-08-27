// frontend/app/components/ConversationItem.tsx
import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Conversation } from '@/app/types';


interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  formatDate: (date: string) => string;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onClick,
  onDelete,
  formatDate,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;

    const confirmed = window.confirm(
      'Are you sure you want to delete this conversation?'
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDelete();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      alert('Failed to delete conversation. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group relative p-4 rounded-2xl transition-all duration-200 cursor-pointer border ${
        isActive
          ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
          : 'bg-gray-800/30 hover:bg-gray-700/40 border-gray-600/20 hover:border-gray-500/30'
      } ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0 pr-2">
          <p
            className={`text-sm font-medium mb-1 truncate ${
              isActive ? 'text-yellow-300' : 'text-white'
            }`}
          >
            {conversation.title || 'New Chat'}
          </p>
          <p className="text-xs text-gray-400 mb-2 line-clamp-2">
            {conversation.messages[0]?.content?.substring(0, 100) ||
              'No messages'}
          </p>
          <p className="text-xs text-gray-500">
            {formatDate(conversation.updatedAt)}
          </p>
        </div>
        {/* Delete button - shows on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-start">
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
            title="Delete conversation"
          >
            {isDeleting ? (
              <div className="w-4 h-4 border border-red-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConversationItem;