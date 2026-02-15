import React, { useState, useCallback, memo } from 'react';
import { Trash2 } from 'lucide-react';

import { Conversation } from '@/src/types/conversation.types';
import DeleteConversationModal from './DeleteModal';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => Promise<void>;
  formatDate: (date: string) => string;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onClick,
  onDelete,
  formatDate,
}) => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteError(null);
    setShowDeleteModal(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      await onDelete();
      setShowDeleteModal(false);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      setDeleteError(
        error instanceof Error 
          ? error.message 
          : 'Failed to delete conversation. Please try again.'
      );
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete]);

  const handleCloseModal = useCallback(() => {
    if (!isDeleting) {
      setShowDeleteModal(false);
      setDeleteError(null);
    }
  }, [isDeleting]);

  // Safely get preview text
  const getPreviewText = () => {
    // Use title if available
    if (conversation.title) {
      return conversation.title;
    }
    
    // Use first message content if available
    if (conversation.messages && conversation.messages.length > 0) {
      const firstMessage = conversation.messages[0];
      return firstMessage?.content?.substring(0, 100) || 'No content';
    }
    
    // Fallback
    return 'New Chat';
  };

  const displayTitle = conversation.title || 'New Chat';
  const previewText = getPreviewText();

  return (
    <>
      <div
        onClick={onClick}
        className={`group relative p-4 rounded-2xl transition-all duration-200 cursor-pointer border ${
          isActive
            ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
            : 'bg-gray-800/30 hover:bg-gray-700/40 border-gray-600/20 hover:border-gray-500/30'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 pr-2">
            <p
              className={`text-sm font-medium mb-1 truncate ${
                isActive ? 'text-yellow-300' : 'text-white'
              }`}
            >
              {displayTitle}
            </p>
            <p className="text-xs text-gray-400 mb-2 line-clamp-2">
              {previewText}
            </p>
            <p className="text-xs text-gray-500">
              {formatDate(conversation.updatedAt)}
            </p>
          </div>
          {/* Delete button - shows on hover */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-start">
            <button
              onClick={handleDeleteClick}
              className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
              title="Delete conversation"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {showDeleteModal && (
        <DeleteConversationModal
          isOpen={showDeleteModal}
          onClose={handleCloseModal}
          onConfirm={handleConfirmDelete}
          conversationTitle={displayTitle}
          isDeleting={isDeleting}
          error={deleteError}
        />
      )}
    </>
  );
};

export default memo(ConversationItem, (prev, next) => {
  return (
    prev.conversation.id === next.conversation.id &&
    prev.conversation.title === next.conversation.title &&
    prev.conversation.updatedAt === next.conversation.updatedAt &&
    prev.isActive === next.isActive
  );
});