"use client";

import React, { useEffect, useCallback, memo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';

import { useAppStore } from '@/src/store/rootStore';
import { User } from '@/src/types/user.types';
import ChatInterface from '@/src/components/chat/interface/ChatInterface';
import Sidebar from '@/src/components/sidebar/Sidebar';
import LoginModal from '@/src/components/auth/AuthModal';
import LogoutModal from '@/src/components/auth/LogoutModal';

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
  const logout = useAppStore((state) => state.logout);
  const reset = useAppStore((state) => state.reset);

  // Mobile sidebar state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  // Modal states - AT ROOT LEVEL
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
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

  // Initialize user on mount
  useEffect(() => {
    console.log('[ChatPage] Component mounted, initializing user');
    initializeUser();
  }, [initializeUser]);

  // Load conversations when user is authenticated
  useEffect(() => {
    if (user && user.id && user.id !== 'guest') {
      console.log('[ChatPage] Loading conversations for authenticated user:', user.id);
      loadConversations();
    }
  }, [user, loadConversations]);

  // Sync URL to state
  useEffect(() => {
    const pathSegments = pathname.split('/').filter(Boolean);
    const conversationId = pathSegments[0];
    
    const urlConversationId = conversationId && conversationId.length > 0 
      ? conversationId 
      : undefined;

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
    if (!newUser || newUser.id === 'guest') {
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

  const handleLoginClick = useCallback(() => {
    console.log('[ChatPage] Login requested from sidebar');
    setShowLoginModal(true);
  }, []);

  const handleLogoutClick = useCallback(() => {
    console.log('[ChatPage] Logout requested');
    setShowLogoutModal(true);
  }, []);

  // NEW: Handle login success
  const handleLoginSuccess = useCallback(async (authenticatedUser: User | null) => {
    console.log('[ChatPage] Login successful:', authenticatedUser);
    setShowLoginModal(false);
    
    // Reinitialize user
    await initializeUser();
    
    // Reload conversations
    if (authenticatedUser && authenticatedUser.id !== 'guest') {
      loadConversations(true);
    }
  }, [initializeUser, loadConversations]);

  const handleLogoutConfirm = useCallback(async () => {
    console.log('[ChatPage] Logout confirmed');
    await logout();
    handleUserChange(null);
    setShowLogoutModal(false);
  }, [logout, handleUserChange]);

  // NEW: Handle modal close
  const handleLoginModalClose = useCallback(() => {
    setShowLoginModal(false);
  }, []);

  // Show loading state
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
    <>
      <div className="flex h-screen overflow-hidden relative">
        {/* Mobile Menu Button */}
        {isMobile && (
          <button
            onClick={handleToggleSidebar}
            className="fixed top-4 left-4 z-50 p-3 bg-gray-800/90 hover:bg-gray-700 border border-gray-600 rounded-xl text-white transition-colors shadow-lg backdrop-blur-sm md:hidden"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        )}

        {/* Backdrop */}
        {isMobile && mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
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
            onLoginClick={handleLoginClick}
            onLogoutClick={handleLogoutClick}
          />
        </div>
        
        {/* Main Chat Area */}
        <div className={`flex-1 flex flex-col overflow-hidden ${isMobile ? 'w-full' : ''}`}>
          <MemoizedChatInterface
            selectedConversationId={currentConversationId}
            onConversationCreated={handleConversationCreated}
          />
        </div>
      </div>

      {/* Login Modal - AT ROOT LEVEL, OUTSIDE MAIN LAYOUT */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={handleLoginModalClose}
        onLoginSuccess={handleLoginSuccess}
        message="Sign in to save your conversations"
      />

      {/* Logout Modal - AT ROOT LEVEL */}
      <LogoutModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleLogoutConfirm}
        userName={user?.name || undefined}
      />
    </>
  );
};

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