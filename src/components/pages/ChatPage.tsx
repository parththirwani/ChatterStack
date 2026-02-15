"use client";

import React, { useEffect, useCallback, memo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';

import { useAppStore } from '@/src/store/rootStore';
import { User } from '@/src/types/user.types';
import ChatInterface from '@/src/components/chat/interface/ChatInterface';
import Sidebar from '@/src/components/sidebar/Sidebar';

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

  // Mobile sidebar state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close mobile menu when conversation changes
  useEffect(() => {
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  }, [currentConversationId, isMobile]);

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
    if (isMobile) {
      setMobileMenuOpen(!mobileMenuOpen);
    } else {
      setSidebarCollapsed(!sidebarCollapsed);
    }
  }, [isMobile, mobileMenuOpen, sidebarCollapsed, setSidebarCollapsed]);

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
      router.push(newUrl);
    }
    
    // Close mobile menu after selection
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  }, [pathname, router, setCurrentConversationId, isMobile]);

  const handleNewChat = useCallback(() => {
    console.log('[ChatPage] New chat requested');
    
    setCurrentConversationId(undefined);
    
    if (pathname !== '/') {
      router.push('/');
    }
    
    // Close mobile menu
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  }, [pathname, router, setCurrentConversationId, isMobile]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    console.log('[ChatPage] New conversation created:', conversationId);
    
    setCurrentConversationId(conversationId);
    loadConversations(true);
    
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      router.replace(newUrl);
    }
  }, [pathname, router, setCurrentConversationId, loadConversations]);

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
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Mobile Menu Button - Fixed top-left */}
      {isMobile && (
        <button
          onClick={handleToggleSidebar}
          className="fixed top-4 left-4 z-50 p-3 bg-gray-800/90 hover:bg-gray-700 border border-gray-600 rounded-xl text-white transition-colors shadow-lg backdrop-blur-sm md:hidden"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
      )}

      {/* Backdrop overlay for mobile */}
      {isMobile && mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop: Normal, Mobile: Slide-out drawer */}
      <div
        className={`
          ${isMobile ? 'fixed inset-y-0 left-0 z-40' : 'relative'}
          ${isMobile && !mobileMenuOpen ? '-translate-x-full' : 'translate-x-0'}
          transition-transform duration-300 ease-in-out
          ${isMobile ? 'w-80' : ''}
        `}
      >
        <MemoizedSidebar
          collapsed={!isMobile && sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          user={user}
          onUserChange={handleUserChange}
          onConversationSelect={handleConversationSelect}
          onNewChat={handleNewChat}
          currentConversationId={currentConversationId}
        />
      </div>
      
      {/* Main Chat Area - Responsive padding */}
      <div className={`
        flex-1 flex flex-col overflow-hidden
        ${isMobile ? 'w-full' : ''}
      `}>
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