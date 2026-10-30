import React, { useRef } from 'react';
import { useModalFocus } from '@/src/hooks/useModalFocus';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useModalFocus(isOpen, onClose, dialogRef, cancelRef);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        className="relative mx-4 w-full max-w-[400px] rounded-2xl border border-white/[0.09] bg-[#202020] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-modal-title" className="mb-2 text-[17px] font-semibold tracking-[-0.01em] text-[#f3f1ee]">
          Delete conversation
        </h2>

        <p className="mb-1 text-[13px] leading-5 text-[#c4c0bb]">
          {`You're about to permanently delete "${conversationTitle}".`}
        </p>
        <p className="text-[12px] leading-5 text-[#8f8b86]">
          This action cannot be undone. All messages in this conversation will be permanently removed.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-[12.5px] text-red-400">{error}</p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            ref={cancelRef}
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-xl px-3.5 py-2 text-[13px] font-medium text-[#c4c0bb] transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-2 rounded-xl bg-[#cf3a3f] px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#d93b40] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConversationModal;
