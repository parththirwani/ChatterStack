import React, { useState, useCallback, memo } from 'react';
import { Trash2, MessageSquare } from 'lucide-react';
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

  const getPreviewText = () => {
    if (conversation.title) {
      return conversation.title;
    }
    
    if (conversation.messages && conversation.messages.length > 0) {
      const firstMessage = conversation.messages[0];
      return firstMessage?.content?.substring(0, 100) || 'No content';
    }
    
    return 'New Chat';
  };

  const displayTitle = conversation.title || 'New Chat';
  const previewText = getPreviewText();

  return (
    <>
      <div
        onClick={onClick}
        className={`
          group relative 
          px-3 py-2.5
          rounded-lg
          transition-all duration-150
          cursor-pointer
          touch-manipulation
          active:scale-[0.98]
          ${
            isActive
              ? 'bg-yellow-500/10 border border-yellow-500/20'
              : 'hover:bg-gray-800/30 border border-transparent'
          }
        `}
      >
        <div className="flex items-start gap-2.5">
          {/* Message icon - minimal */}
          <div className={`
            flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center mt-0.5
            ${isActive 
              ? 'bg-yellow-500/20 text-yellow-400' 
              : 'bg-gray-800/50 text-gray-500'
            }
          `}>
            <MessageSquare className="w-3 h-3" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Title - clean typography */}
            <p className={`
              text-sm font-medium mb-0.5 truncate
              ${isActive 
                ? 'text-white' 
                : 'text-gray-300 group-hover:text-white'
              }
            `}>
              {displayTitle}
            </p>
            
            {/* Preview - subtle */}
            <p className="text-xs text-gray-500 line-clamp-1 break-words">
              {previewText}
            </p>
            
            {/* Date - very subtle */}
            <p className="text-xs text-gray-600 mt-1">
              {formatDate(conversation.updatedAt)}
            </p>
          </div>
          
          {/* Delete button - appears on hover, minimal */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-start shrink-0">
            <button
              onClick={handleDeleteClick}
              className="
                p-1.5
                rounded-md
                hover:bg-red-500/10
                text-gray-500 hover:text-red-400
                transition-colors
                cursor-pointer
                touch-manipulation
                active:scale-95
              "
              title="Delete conversation"
              aria-label="Delete conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
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