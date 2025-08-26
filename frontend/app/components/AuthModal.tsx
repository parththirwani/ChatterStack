import React, { useEffect, useState } from 'react';
import { X, Github } from 'lucide-react';
import Image from "next/image";

const BACKEND_URL = "http://localhost:3000";

type User = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
};

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: (user: User) => void;
}

const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  // Check if user is already logged in when modal opens
  useEffect(() => {
    if (isOpen) {
      checkAuthStatus();
    }
  }, [isOpen]);

  // Check authentication status
  const checkAuthStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // important: send cookies
        body: JSON.stringify({ userId: user?.id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          if (onLoginSuccess) {
            onLoginSuccess(data.user);
          }
        }
      }
    } catch (err) {
      console.error("Error checking auth status", err);
    }
  };

  const handleLogin = (provider: "google" | "github") => {
    setLoading(true);
    // Close modal before redirecting
    onClose();
    // Redirect user to backend OAuth route
    window.location.href = `${BACKEND_URL}/auth/${provider}`;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
    } catch (err) {
      console.error("Error logging out", err);
    }
  };

  const handleGuestContinue = () => {
    onClose();
    if (onLoginSuccess) {
      // Pass null or a guest user object
      onLoginSuccess({
        id: 'guest',
        name: 'Guest User',
        email: null,
        avatarUrl: null,
        provider: 'guest'
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* If user is already logged in, show user info */}
        {user && user.id !== 'guest' ? (
          <div className="text-center">
            <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mx-auto mb-4">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt="User Avatar"
                  className="w-full h-full rounded-lg object-cover"
                />
              ) : (
                <span className="text-black font-bold text-xl">
                  {user.name?.charAt(0) || 'U'}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Welcome back, {user.name || 'User'}!
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              You're already signed in with {user.provider}
            </p>

            <div className="space-y-4">
              <button
                onClick={() => {
                  onClose();
                  if (onLoginSuccess) onLoginSuccess(user);
                }}
                className="w-full bg-yellow-500 text-black py-3 px-6 rounded-xl font-medium hover:bg-yellow-400 transition-colors"
              >
                Continue
              </button>

              <button
                onClick={handleLogout}
                className="w-full bg-transparent text-gray-400 py-3 px-6 rounded-xl border border-gray-700 hover:border-red-500 hover:text-red-400 transition-colors font-medium"
              >
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <>

            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Image
                  src="/logo.png" // public/logo.png
                  alt="ChatterStack Logo"
                  width={48}
                  height={48}
                  className="rounded-lg"
                />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Welcome to <span className="text-yellow-500">ChatterStack</span>
              </h2>
              <p className="text-gray-400 text-sm">
                Sign in to continue your conversations
              </p>
            </div>



            {/* Auth Buttons */}
            <div className="space-y-4">
              {/* Google Auth Button */}
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

              {/* GitHub Auth Button */}
              <button
                onClick={() => handleLogin("github")}
                disabled={loading}
                className="w-full bg-[#211d22] text-white py-3 px-6 rounded-xl flex items-center justify-center space-x-3 hover:bg-gray-700 transition-colors font-medium border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Github className="w-5 h-5" />
                <span>{loading ? 'Signing in...' : 'Continue with GitHub'}</span>
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center my-6">
              <div className="flex-1 border-t border-gray-700"></div>
              <span className="px-4 text-xs text-gray-400 uppercase tracking-wide">Or</span>
              <div className="flex-1 border-t border-gray-700"></div>
            </div>

            {/* Guest Option */}
            <button
              onClick={handleGuestContinue}
              disabled={loading}
              className="w-full bg-transparent text-gray-400 py-3 px-6 rounded-xl border border-gray-700 hover:border-yellow-500 hover:text-white transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue as Guest
            </button>

            {/* Footer */}
            <p className="text-center text-xs text-gray-400 mt-6">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginModal;