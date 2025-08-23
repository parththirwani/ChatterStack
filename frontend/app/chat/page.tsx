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

  // OAuth callback handler
  useEffect(() => {
    // Check URL parameters for OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const authStatus = urlParams.get('auth');
    
    if (authStatus === 'success') {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Check auth status to get user data
      checkAuthStatusAfterLogin();
    } else if (authStatus === 'error') {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      console.error('OAuth login failed');
      // You can add error handling here (show toast, etc.)
    }
  }, []);

  // Check authentication status after OAuth login
  const checkAuthStatusAfterLogin = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Important: send cookies
        body: JSON.stringify({}), // Empty body since we'll get user from token
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          // Update user state
          setUser(data.user);
          console.log('Login successful:', data.user);
        }
      } else {
        console.error('Failed to validate user after OAuth');
      }
    } catch (err) {
      console.error("Error checking auth status after login", err);
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
    <ChatterStackPage
      user={user}
      onUserChange={handleUserChange}
      onCallChat={handleCallChat}
      loading={loading}
    />
  );
}