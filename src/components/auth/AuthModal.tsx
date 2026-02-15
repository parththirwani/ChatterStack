import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { useAppStore } from '@/src/store/rootStore';
import type { User } from '@/src/types/user.types';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: (user: User | null) => void;
  message?: string;
}

const LoginModal: React.FC<LoginModalProps> = ({ 
  isOpen, 
  onClose,
  onLoginSuccess,
  message 
}) => {
  const [loading, setLoading] = React.useState(false);
  const initializeUser = useAppStore((state) => state.initializeUser);
  const user = useAppStore((state) => state.user);

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

  // OAuth login using NextAuth
  const handleLogin = async (provider: "google" | "github") => {
    setLoading(true);
    try {
      // Use NextAuth's signIn function
      await signIn(provider, {
        callbackUrl: '/?auth=success',
        redirect: true,
      });
    } catch (error) {
      console.error('Login error:', error);
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-[#141017] border border-gray-700 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          disabled={loading}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Login view */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-4">
            <Image
              src="/logo.png"
              alt="ChatterStack Logo"
              width={48}
              height={48}
              className="rounded-lg"
            />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">
            Sign in to <span className="text-yellow-500">ChatterStack</span>
          </h2>
          <p className="text-gray-400 text-sm">
            {message || "Sign in to continue your conversation"}
          </p>
        </div>

        <div className="space-y-4">
          {/* Google */}
          <button
            onClick={() => handleLogin("google")}
            disabled={loading}
            className="w-full bg-white text-black py-3 px-6 rounded-xl flex items-center justify-center space-x-3 hover:bg-gray-100 transition-colors font-medium border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
          </button>

          {/* GitHub */}
          <button
            onClick={() => handleLogin("github")}
            disabled={loading}
            className="w-full bg-[#211d22] text-white py-3 px-6 rounded-xl flex items-center justify-center space-x-3 hover:bg-gray-700 transition-colors font-medium border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Image
              src="/github.svg"
              alt="GitHub Logo"
              width={20}
              height={20}
            />
            <span>{loading ? 'Signing in...' : 'Continue with GitHub'}</span>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
};

export default LoginModal;