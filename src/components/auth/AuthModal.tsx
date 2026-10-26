import React, { useEffect, useRef, memo } from 'react';
import { X } from 'lucide-react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { useAppStore } from '@/src/store/rootStore';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { authErrorMessage } from '@/src/lib/auth/error-messages';
import type { User } from '@/src/types/user.types';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: (user: User | null) => void;
  message?: string;
  // NextAuth error code from the OAuth redirect (?error=...).
  initialError?: string | null;
}

const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  message,
  initialError,
}) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const initializeUser = useAppStore((state) => state.initializeUser);
  const user = useAppStore((state) => state.user);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus(isOpen, onClose, dialogRef, firstActionRef);

  // Detect successful OAuth login
  useEffect(() => {
    if (!isOpen) return;

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('auth') && urlParams.get('auth') === 'success') {
      // Clear the auth param from URL
      window.history.replaceState({}, document.title, window.location.pathname);

      // Initialize user from store
      initializeUser().then(() => {
      });
    }
  }, [isOpen, initializeUser]);

  // When user changes (after successful login), notify parent
  useEffect(() => {
    if (isOpen && user && user.id && user.id !== 'guest') {
      if (onLoginSuccess) {
        onLoginSuccess(user);
      } else {
        onClose();
      }
    }
  }, [user, isOpen, onLoginSuccess, onClose]);

  // Reset transient state each time the modal opens, and surface errors
  // handed back by the OAuth redirect (e.g. ?error=Configuration).
  useEffect(() => {
    if (!isOpen) return;
    setLoading(false);
    setError(authErrorMessage(initialError));
  }, [isOpen, initialError]);

  // OAuth login using NextAuth
  const handleLogin = async (provider: 'google' | 'github') => {
    setLoading(true);
    setError(null);
    try {
      const result = await signIn(provider, {
        callbackUrl: '/chat?auth=success',
        redirect: false,
      });

      if (result?.error) {
        setError(authErrorMessage(result.error));
        setLoading(false);
        return;
      }

      if (result?.url) {
        window.location.assign(result.url);
        return;
      }

      setError(authErrorMessage('OAuthSignin'));
      setLoading(false);
    } catch (loginError) {
      console.error('Login error:', loginError);
      setError(authErrorMessage('OAuthSignin'));
      setLoading(false);
    }
  };

  if (!isOpen) return null;

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
        aria-labelledby="login-modal-title"
        className="relative w-full max-w-[400px] rounded-2xl border border-white/[0.09] bg-[#202020] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-lg text-[#8f8b86] transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
          disabled={loading}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 h-11 w-11 overflow-hidden rounded-xl">
            <Image
              src="/logo.png"
              alt=""
              width={44}
              height={44}
              className="h-full w-full object-cover"
            />
          </div>

          <h2 id="login-modal-title" className="text-[19px] font-semibold tracking-[-0.01em] text-[#f3f1ee]">
            Sign in to ChatterStack
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-[#a7a39e]">
            {message || 'Sign in to continue your conversation.'}
          </p>
        </div>

        <div className="space-y-2.5">
          {/* Google */}
          <button
            ref={firstActionRef}
            onClick={() => handleLogin('google')}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#f3f1ee] px-5 py-2.5 text-[13.5px] font-medium text-[#1b1a18] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>{loading ? 'Signing in…' : 'Continue with Google'}</span>
          </button>

          {/* GitHub */}
          <button
            onClick={() => handleLogin('github')}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 py-2.5 text-[13.5px] font-medium text-[#f3f1ee] transition-colors hover:border-white/[0.2] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Image src="/github.svg" alt="" width={17} height={17} />
            <span>{loading ? 'Signing in…' : 'Continue with GitHub'}</span>
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-[12.5px] leading-5 text-red-200">
            {error}
          </p>
        )}

        <p className="mt-6 text-center text-[11.5px] leading-5 text-[#8f8b86]">
          By continuing, you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
};

export default memo(LoginModal);
