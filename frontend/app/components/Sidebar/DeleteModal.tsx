// frontend/app/components/DeleteConversationModal.tsx
import React from 'react';
import { AlertTriangle, X, Trash2, AlertCircle } from 'lucide-react';

interface DeleteConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  conversationTitle?: string;
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

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isDeleting) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-[#282230] border border-gray-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700/50">
          <div className="flex items-center gap-3">
            {error ? (
              <div className="p-2 bg-red-500/20 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
            ) : (
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              </div>
            )}
            <h2 className="text-lg font-semibold text-white">
              {error ? 'Delete Failed' : 'Delete Conversation'}
            </h2>
          </div>
          {!isDeleting && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-700/50 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {error ? (
            // Error State
            <div className="space-y-4">
              <p className="text-gray-300 text-sm leading-relaxed">
                Failed to delete the conversation. This might be due to a network issue or server error.
              </p>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-red-400 text-xs font-mono">{error}</p>
              </div>
              <p className="text-gray-400 text-xs">
                Please try again. If the problem persists, contact support.
              </p>
            </div>
          ) : (
            // Confirmation State
            <div className="space-y-4">
              <p className="text-gray-300 text-sm leading-relaxed">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-white">
                  "{conversationTitle || 'this conversation'}"
                </span>
                ?
              </p>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                <p className="text-yellow-400 text-xs">
                  ⚠️ This action cannot be undone. All messages in this conversation will be permanently deleted.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 bg-[#1a1721] border-t border-gray-700/50">
          {error ? (
            // Error State Buttons
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Try Again
              </button>
            </>
          ) : (
            // Confirmation State Buttons
            <>
              <button
                onClick={onClose}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[100px] justify-center"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeleteConversationModal;