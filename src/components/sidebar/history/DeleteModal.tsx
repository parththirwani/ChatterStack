import React from 'react';
import { X } from 'lucide-react';

interface DeleteConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  conversationTitle: string;
  isDeleting?: boolean;
  error?: string | null;
}

const DeleteConversationModal: React.FC<DeleteConversationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  conversationTitle,
  isDeleting = false,
  error = null,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-[#201D26] rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">
            Delete conversation
          </h2>
        </div>

        {/* Content */}
        <div className="mb-6">
          <p className="text-gray-300 text-sm mb-2">
            You're about to permanently delete{" "}
            <span className="font-semibold text-white">
              "{conversationTitle}"
            </span>.
          </p>
          <p className="text-gray-400 text-xs">
            This action cannot be undone. All messages in this conversation will
            be permanently removed.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 
                       hover:bg-gray-700/50 transition-all duration-150
                       cursor-pointer disabled:cursor-not-allowed 
                       disabled:opacity-50 active:scale-[0.98]"
          >
            Cancel
          </button>

          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg text-sm font-medium 
                       bg-red-600 hover:bg-red-700 text-white
                       transition-all duration-150 flex items-center gap-2
                       cursor-pointer disabled:cursor-not-allowed 
                       disabled:opacity-50 active:scale-[0.98]"
          >
            {isDeleting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete conversation'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConversationModal;
