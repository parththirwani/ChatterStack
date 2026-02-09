import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ChatInterface from './ChatInterface/ChatInterface';
import type { User } from '../types';
import Sidebar from './Sidebar';
import { ApiService } from '../services/api';

const ChatPage: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [refreshConversations, setRefreshConversations] = useState(0);

  // Track if we've initialized to prevent loops
  const initializedRef = useRef(false);
  const lastPathnameRef = useRef<string>('');

  // Initialize user only once on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initializeUser = async () => {
      try {
        const currentUser = await ApiService.getCurrentUser();
        setUser(currentUser);
      } catch (error) {
        console.error('Failed to get current user:', error);
        setUser(null);
      } finally {
        setUserLoading(false);
      }
    };

    initializeUser();
  }, []);

  // Sync URL to state on mount and browser back/forward
  useEffect(() => {
    // Only sync from URL on initial mount or browser navigation
    if (pathname === lastPathnameRef.current) {
      return; // No change, skip
    }

    lastPathnameRef.current = pathname;

    const pathSegments = pathname.split('/').filter(Boolean);
    const conversationId = pathSegments[0];
    
    const newConversationId = conversationId && conversationId.length > 0 
      ? conversationId 
      : undefined;

    console.log('URL changed to:', pathname, 'conversation:', newConversationId);
    setSelectedConversationId(newConversationId);
  }, [pathname]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const handleUserChange = useCallback((newUser: User | null) => {
    setUser(newUser);
    setSelectedConversationId(undefined);
    
    // Navigate to home
    if (pathname !== '/') {
      lastPathnameRef.current = '/';
      router.push('/');
    }
  }, [pathname, router]);

  const handleConversationSelect = useCallback((conversationId: string) => {
    console.log('Conversation selected:', conversationId);
    
    // Update state immediately - NO navigation!
    setSelectedConversationId(conversationId);
    
    // Update URL without navigation using window.history
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      lastPathnameRef.current = newUrl;
      window.history.pushState({}, '', newUrl);
    }
  }, [pathname]);

  const handleNewChat = useCallback(() => {
    console.log('New chat requested');
    
    // Clear conversation state immediately - NO navigation!
    setSelectedConversationId(undefined);
    
    // Update URL without navigation
    if (pathname !== '/') {
      lastPathnameRef.current = '/';
      window.history.pushState({}, '', '/');
    }
  }, [pathname]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    console.log('New conversation created:', conversationId);
    
    // Update state immediately - NO navigation!
    setSelectedConversationId(conversationId);
    
    // Trigger sidebar refresh
    setRefreshConversations((prev) => prev + 1);
    
    // Update URL without navigation using window.history
    const newUrl = `/${conversationId}`;
    if (pathname !== newUrl) {
      lastPathnameRef.current = newUrl;
      window.history.replaceState({}, '', newUrl); // Use replace for new conversations
    }
  }, [pathname]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      // When user clicks back/forward, pathname will change
      // and the pathname effect above will handle it
      console.log('Browser navigation detected');
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
        currentConversationId={selectedConversationId}
        refreshTrigger={refreshConversations}
      />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <MemoizedChatInterface
          selectedConversationId={selectedConversationId}
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
    prev.currentConversationId === next.currentConversationId &&
    prev.refreshTrigger === next.refreshTrigger
  );
});

MemoizedChatInterface.displayName = 'MemoizedChatInterface';
MemoizedSidebar.displayName = 'MemoizedSidebar';

export default memo(ChatPage);