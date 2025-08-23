"use client"
import React, { useState, useEffect } from 'react';
import Sidebar from './SideBar';
import ChatInterface from './ChatInterface';

const BACKEND_URL = "http://localhost:3000";

type User = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
};

const ChatterStackPage: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isFirstMessage, setIsFirstMessage] = useState(true);

  // OAuth callback handler
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authParam = urlParams.get('auth');
    
    if (authParam === 'success') {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      // Check auth status to get user data
      checkAuthStatusAfterLogin();
    } else if (authParam === 'error') {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      // Check if user is already logged in on page load
      checkExistingAuth();
    }
  }, []);

  // Check if user is already authenticated (on page load)
  const checkExistingAuth = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
        }
      }
    } catch (err) {
      console.error("Error checking existing auth", err);
    }
  };

  // Check authentication status after OAuth login
  const checkAuthStatusAfterLogin = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
        }
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

  const handleFirstMessage = () => {
    setIsFirstMessage(false);
  };

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className="flex h-screen text-white" style={{ backgroundColor: '#221c24' }}>
      <Sidebar 
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        user={user}
        onUserChange={handleUserChange}
      />
      <ChatInterface
        isFirstMessage={isFirstMessage}
        onFirstMessage={handleFirstMessage}
        onCallChat={handleCallChat}
        loading={loading}
      />
    </div>
  );
};

export default ChatterStackPage;