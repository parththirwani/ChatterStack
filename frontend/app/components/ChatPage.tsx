"use client";

import React, { useEffect, useCallback, memo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ChatInterface from './ChatInterface/ChatInterface';
import Sidebar from './Sidebar';
import { useAppStore } from '../store/useAppStore';

const ChatPage: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  
  // Zustand selectors - only subscribe to what we need
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
    initializeUser();
  }, [initializeUser]);

  // Load conversations when user is authenticated
  useEffect(() => {
    if (user && user.id && user.id !== 'guest') {
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
      console.log('URL changed, updating conversation ID:', urlConversationId);
      setCurrentConversationId(urlConversationId);
    }
  }, [pathname, currentConversationId, setCurrentConversationId]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  const handleUserChange = useCallback((newUser: any | null) => {
    if (!newUser) {
      // User logged out
      reset();
      if (pathname !== '/') {
        router.push('/');
      }
    }
  }, [pathname, router, reset]);

  const handleConversationSelect = useCallback((conversationId: string) => {
    console.log('Conversation selected:', conversationId);
    
    // Update state WITHOUT navigation
    setCurrentConversationId(conversationId);
    
    // Update URL without triggering navigation
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      window.history.pushState({}, '', newUrl);
    }
  }, [pathname, setCurrentConversationId]);

  const handleNewChat = useCallback(() => {
    console.log('New chat requested');
    
    // Clear conversation WITHOUT navigation
    setCurrentConversationId(undefined);
    
    // Update URL without triggering navigation
    if (pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
  }, [pathname, setCurrentConversationId]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    console.log('New conversation created:', conversationId);
    
    // Update state WITHOUT navigation
    setCurrentConversationId(conversationId);
    
    // Reload conversations to get the new one
    loadConversations(true);
    
    // Update URL without triggering navigation
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      window.history.replaceState({}, '', newUrl);
    }
  }, [pathname, setCurrentConversationId, loadConversations]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      console.log('Browser navigation detected');
      // pathname effect will handle the update
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

// Memoize ChatInterface to prevent unnecessary re-renders
const MemoizedChatInterface = memo(ChatInterface, (prev, next) => {
  return prev.selectedConversationId === next.selectedConversationId;
});

// Memoize Sidebar to prevent unnecessary re-renders
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