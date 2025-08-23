"use client"
import React, { useState, useEffect } from 'react';
import ChatterStackPage from '../components/ChatPage';

const BACKEND_URL = "http://localhost:3000";

type User = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
};

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<'checking' | 'success' | 'error' | null>(null);

  // OAuth callback handler
  useEffect(() => {
    // Check URL parameters for OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const authParam = urlParams.get('auth');
    
    console.log('Auth param from URL:', authParam);
    
    if (authParam === 'success') {
      setAuthStatus('checking');
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Check auth status to get user data
      checkAuthStatusAfterLogin();
    } else if (authParam === 'error') {
      setAuthStatus('error');
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      console.error('OAuth login failed');
      
      // Clear error status after 5 seconds
      setTimeout(() => {
        setAuthStatus(null);
      }, 5000);
    } else {
      // Check if user is already logged in on page load
      checkExistingAuth();
    }
  }, []);

  // Check if user is already authenticated (on page load)
  const checkExistingAuth = async () => {
    try {
      console.log('Checking existing auth...');
      const res = await fetch(`${BACKEND_URL}/auth/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      console.log('Auth check response status:', res.status);
      
      if (res.ok) {
        const data = await res.json();
        console.log('Auth check response data:', data);
        if (data.user) {
          setUser(data.user);
          console.log('User already logged in:', data.user);
        }
      }
    } catch (err) {
      console.error("Error checking existing auth", err);
    }
  };

  // Check authentication status after OAuth login
  const checkAuthStatusAfterLogin = async () => {
    try {
      console.log('Checking auth status after OAuth login...');
      console.log('Making request to:', `${BACKEND_URL}/auth/validate`);
      
      const res = await fetch(`${BACKEND_URL}/auth/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Important: send cookies
      });
      
      console.log('Response status:', res.status);
      console.log('Response headers:', res.headers);
      
      if (res.ok) {
        const data = await res.json();
        console.log('Response data:', data);
        if (data.user) {
          // Update user state
          setUser(data.user);
          setAuthStatus('success');
          console.log('Login successful:', data.user);
          
          // Clear success status after 3 seconds
          setTimeout(() => {
            setAuthStatus(null);
          }, 3000);
        }
      } else {
        const errorText = await res.text();
        console.error('Failed to validate user after OAuth:', res.status, errorText);
        setAuthStatus('error');
        setTimeout(() => {
          setAuthStatus(null);
        }, 5000);
      }
    } catch (err) {
      console.error("Error checking auth status after login", err);
      console.error("Error details:", {
        message: err.message,
        stack: err.stack
      });
      setAuthStatus('error');
      setTimeout(() => {
        setAuthStatus(null);
      }, 5000);
    }
  };

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
  };

  const handleCallChat = async () => {
    setLoading(true);
    try {
      // Your chat logic here
      await new Promise(resolve => setTimeout(resolve, 1000)); // Example async operation
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      {/* Auth Status Toast */}
      {authStatus && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg transition-all duration-300 ${
          authStatus === 'success' 
            ? 'bg-green-600 text-white' 
            : authStatus === 'error' 
              ? 'bg-red-600 text-white' 
              : 'bg-blue-600 text-white'
        }`}>
          {authStatus === 'checking' && '🔄 Logging you in...'}
          {authStatus === 'success' && '✅ Login successful!'}
          {authStatus === 'error' && '❌ Login failed. Please try again.'}
        </div>
      )}
      
      <ChatterStackPage
        user={user}
        onUserChange={handleUserChange}
        onCallChat={handleCallChat}
        loading={loading}
      />
    </div>
  );
}