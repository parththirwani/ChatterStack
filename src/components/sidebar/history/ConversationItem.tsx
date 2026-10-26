import React, { useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
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

  const displayTitle = conversation.title || 'New Chat';

  return (
    <>
      <div
        className={`
          group relative flex items-center
          rounded-lg
          transition-colors duration-150
          ${isActive ? 'bg-white/[0.07]' : 'hover:bg-white/[0.045]'}
        `}
      >
        <button
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 truncate rounded-lg px-3 py-2 pr-10 text-left text-[13px] leading-5 transition-colors focus-visible:outline-none"
        >
          <span className={`block truncate ${isActive ? 'text-white' : 'text-[#c4c0bb] group-hover:text-white'}`}>
            {displayTitle}
          </span>
        </button>

        <button
          onClick={handleDeleteClick}
          className={`
            absolute right-1.5 top-1/2 ${isActive ? 'flex' : 'hidden sm:flex'} h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md
            text-[#726e6a] sm:text-[#8f8b86] transition-colors hover:bg-red-500/10 hover:text-red-400
            cursor-pointer touch-manipulation
            opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100
          `}
          title="Delete conversation"
          aria-label="Delete conversation"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {showDeleteModal && typeof document !== 'undefined' && createPortal(
        <DeleteConversationModal
          isOpen={showDeleteModal}
          onClose={handleCloseModal}
          onConfirm={handleConfirmDelete}
          conversationTitle={displayTitle}
          isDeleting={isDeleting}
          error={deleteError}
        />,
        document.body
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