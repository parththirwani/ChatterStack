import React, { useRef } from 'react';
import { X, LogOut, AlertTriangle } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useModalFocus } from '@/src/hooks/useModalFocus';

interface LogoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  userName?: string;
}

const LogoutModal: React.FC<LogoutModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  userName,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useModalFocus(isOpen, onClose, dialogRef, cancelRef);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    // Sign out using NextAuth
    await signOut({ redirect: false });
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        className="relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#202020] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3.5 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-[#8f8b86] transition-colors hover:bg-white/[0.06] hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Content */}
        <div className="p-8">
          {/* Icon */}
          <div className="mb-5 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-400" strokeWidth={1.8} />
            </div>
          </div>

          {/* Title */}
          <h2 id="logout-modal-title" className="mb-2 text-center text-[19px] font-semibold tracking-[-0.01em] text-[#f3f1ee]">
            Sign out?
          </h2>

          {/* Message */}
          <p className="mb-7 text-center text-[13px] leading-5 text-[#a7a39e]">
            {userName ? (
              <>
                You&apos;ll need to sign in again to access your conversations, <span className="font-medium text-[#e6e3de]">{userName}</span>.
              </>
            ) : (
              'You will need to sign in again to access your conversations.'
            )}
          </p>

          {/* Buttons */}
          <div className="flex gap-2.5">
            <button
              ref={cancelRef}
              onClick={onClose}
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-[13.5px] font-medium text-[#e6e3de] transition-colors hover:bg-white/[0.08]"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#cf3a3f] px-4 py-2.5 text-[13.5px] font-medium text-white transition-colors hover:bg-[#d93b40]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogoutModal;
