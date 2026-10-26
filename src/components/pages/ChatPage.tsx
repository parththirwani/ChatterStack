"use client";

import React, { useEffect, useLayoutEffect, useCallback, memo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';

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
  const menuWasOpenRef = useRef(false);
  
  // Modal states - AT ROOT LEVEL
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Close mobile menu when conversation changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentConversationId]);

  // Initialize user on mount. This also covers the return from the
  // full-page OAuth redirect (`/?auth=success`): all modal state is wiped
  // by the navigation, so the AuthModal's own `auth=success` detector never
  // runs. Handling it here guarantees the session is loaded and the flag
  // is cleared even when no modal is open.
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('auth') && urlParams.get('auth') === 'success') {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch {
      // non-browser environment - ignore
    }
    initializeUser();
  }, [initializeUser]);

  // Load conversations when user is authenticated
  useEffect(() => {
    if (user && user.id && user.id !== 'guest') {
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
      setCurrentConversationId(urlConversationId);
    }
  }, [pathname, currentConversationId, setCurrentConversationId]);

  const handleToggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) setMobileMenuOpen((open) => !open);
    else {
      setSidebarCollapsed(!sidebarCollapsed);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(sidebarCollapsed ? '[aria-label="Close sidebar"]' : '[aria-label="Open sidebar"]')?.focus();
      }, 0);
    }
  }, [sidebarCollapsed, setSidebarCollapsed]);

  useEffect(() => {
    window.addEventListener('chatterstack:toggle-sidebar', handleToggleSidebar);
    return () => window.removeEventListener('chatterstack:toggle-sidebar', handleToggleSidebar);
  }, [handleToggleSidebar]);

  useLayoutEffect(() => {
    if (mobileMenuOpen) {
      menuWasOpenRef.current = true;
      window.setTimeout(() => document.querySelector<HTMLElement>('#chat-sidebar button')?.focus(), 30);
    } else if (menuWasOpenRef.current) {
      menuWasOpenRef.current = false;
      window.setTimeout(() => document.getElementById('chat-sidebar-toggle')?.focus(), 30);
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
      if (event.key === 'Tab') {
        const controls = Array.from(document.querySelectorAll<HTMLElement>('#chat-sidebar a, #chat-sidebar button, #chat-sidebar input')).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  const handleUserChange = useCallback((newUser: User | null) => {
    if (!newUser || newUser.id === 'guest') {
      reset();
      if (pathname !== '/') {
        router.push('/');
      }
    }
  }, [pathname, router, reset]);

  const handleConversationSelect = useCallback((conversationId: string) => {
    
    setCurrentConversationId(conversationId);
    
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      router.push(newUrl);
    }
    
    setMobileMenuOpen(false);
  }, [pathname, router, setCurrentConversationId]);

  const handleNewChat = useCallback(() => {
    
    setCurrentConversationId(undefined);
    
    if (pathname !== '/') {
      router.push('/');
    }
    
    setMobileMenuOpen(false);
  }, [pathname, router, setCurrentConversationId]);

  useEffect(() => {
    window.addEventListener('chatterstack:new-chat', handleNewChat);
    return () => window.removeEventListener('chatterstack:new-chat', handleNewChat);
  }, [handleNewChat]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    
    setCurrentConversationId(conversationId);
    loadConversations(true);
    
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      router.replace(newUrl);
    }
  }, [pathname, router, setCurrentConversationId, loadConversations]);

  const handleLoginClick = useCallback(() => {
    setShowLoginModal(true);
  }, []);

  const handleLogoutClick = useCallback(() => {
    setShowLogoutModal(true);
  }, []);

  // NEW: Handle login success
  const handleLoginSuccess = useCallback(async (authenticatedUser: User | null) => {
    setShowLoginModal(false);
    
    // Reinitialize user
    await initializeUser();
    
    // Reload conversations
    if (authenticatedUser && authenticatedUser.id !== 'guest') {
      loadConversations(true);
    }
  }, [initializeUser, loadConversations]);

  const handleLogoutConfirm = useCallback(async () => {
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
      <div className="flex h-dvh items-center justify-center bg-[#191919]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
          <p className="text-[#aaa6a2]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative flex h-dvh overflow-hidden">
        <a href="#chat-main" tabIndex={mobileMenuOpen ? -1 : 0} className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-[#2c2c2c] focus:px-4 focus:py-2 focus:text-white">Skip to chat</a>
        {/* Backdrop */}
        {mobileMenuOpen && (
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          id="chat-sidebar"
          aria-label="Chat navigation"
          inert={sidebarCollapsed && !mobileMenuOpen}
          className={`
            fixed inset-y-0 left-0 z-40 w-72 transition-[transform,width] duration-200 ease-out lg:relative lg:z-auto lg:overflow-hidden lg:translate-x-0
            ${sidebarCollapsed ? 'lg:w-0' : 'lg:w-72'}
            ${mobileMenuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible'}
          `}
        >
          <button ref={(node) => { if (node && mobileMenuOpen) node.focus(); }} type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white lg:hidden"><X className="h-4 w-4" /></button>
          <MemoizedSidebar
            collapsed={false}
            onToggleCollapse={handleToggleSidebar}
            user={user}
            onUserChange={handleUserChange}
            onConversationSelect={handleConversationSelect}
            onNewChat={handleNewChat}
            currentConversationId={currentConversationId}
            onLoginClick={handleLoginClick}
            onLogoutClick={handleLogoutClick}
          />
        </aside>
        
        {/* Main Chat Area */}
        <main id="chat-main" inert={mobileMenuOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <MemoizedChatInterface
            selectedConversationId={currentConversationId}
            onConversationCreated={handleConversationCreated}
            mobileMenuOpen={mobileMenuOpen}
            sidebarCollapsed={sidebarCollapsed}
          />
        </main>
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

const MemoizedChatInterface = memo(ChatInterface);

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
