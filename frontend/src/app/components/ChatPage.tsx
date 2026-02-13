"use client";

import React, { useEffect, useCallback, memo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ChatInterface from './ChatInterface/ChatInterface';
import Sidebar from './Sidebar';
import { useAppStore } from '../store/useAppStore';
import { User } from '../types';

const ChatPage: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  
  // Zustand selectors
  const user = useAppStore((state) => state.user);
  const userLoading = useAppStore((state) => state.userLoading);
  const currentConversationId = useAppStore((state) => state.currentConversationId);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  
  // Actions
  const initializeUser = useAppStore((state) => state.initializeUser);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const setCurrentConversationId = useAppStore((state) => state.setCurrentConversationId);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const reset = useAppStore((state) => state.reset);

  // Initialize user on mount - ONLY ONCE
  useEffect(() => {
    console.log('[ChatPage] Initializing user');
    initializeUser();
  }, [initializeUser]);

  // Load conversations when user is authenticated
  useEffect(() => {
    if (user && user.id && user.id !== 'guest') {
      console.log('[ChatPage] Loading conversations for authenticated user');
      loadConversations();
    }
  }, [user, loadConversations]);

  // Sync URL to state (browser navigation)
  useEffect(() => {
    const pathSegments = pathname.split('/').filter(Boolean);
    const conversationId = pathSegments[0];
    
    const urlConversationId = conversationId && conversationId.length > 0 
      ? conversationId 
      : undefined;

    // Only update if different to prevent loops
    if (urlConversationId !== currentConversationId) {
      console.log('[ChatPage] URL changed, updating conversation ID:', urlConversationId);
      setCurrentConversationId(urlConversationId);
    }
  }, [pathname, currentConversationId, setCurrentConversationId]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  const handleUserChange = useCallback((newUser: User | null) => {
    if (!newUser) {
      console.log('[ChatPage] User logged out, resetting state');
      reset();
      if (pathname !== '/') {
        router.push('/');
      }
    }
  }, [pathname, router, reset]);

  const handleConversationSelect = useCallback((conversationId: string) => {
    console.log('[ChatPage] Conversation selected:', conversationId);
    
    setCurrentConversationId(conversationId);
    
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      window.history.pushState({}, '', newUrl);
    }
  }, [pathname, setCurrentConversationId]);

  const handleNewChat = useCallback(() => {
    console.log('[ChatPage] New chat requested');
    
    setCurrentConversationId(undefined);
    
    if (pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
  }, [pathname, setCurrentConversationId]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    console.log('[ChatPage] New conversation created:', conversationId);
    
    setCurrentConversationId(conversationId);
    loadConversations(true);
    
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      window.history.replaceState({}, '', newUrl);
    }
  }, [pathname, setCurrentConversationId, loadConversations]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      console.log('[ChatPage] Browser navigation detected');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Show loading state while initializing
  if (userLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#201d26]">
        <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <MemoizedSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        user={user}
        onUserChange={handleUserChange}
        onConversationSelect={handleConversationSelect}
        onNewChat={handleNewChat}
        currentConversationId={currentConversationId}
      />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <MemoizedChatInterface
          selectedConversationId={currentConversationId}
          onConversationCreated={handleConversationCreated}
        />
      </div>
    </div>
  );
};

// Memoized components
const MemoizedChatInterface = memo(ChatInterface, (prev, next) => {
  return prev.selectedConversationId === next.selectedConversationId;
});

const MemoizedSidebar = memo(Sidebar, (prev, next) => {
  return (
    prev.collapsed === next.collapsed &&
    prev.user?.id === next.user?.id &&
    prev.currentConversationId === next.currentConversationId
  );
});

MemoizedChatInterface.displayName = 'MemoizedChatInterface';
MemoizedSidebar.displayName = 'MemoizedSidebar';

export default memo(ChatPage);