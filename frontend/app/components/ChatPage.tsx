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

  // Use refs to prevent navigation loops and unnecessary re-renders
  const isNavigatingRef = useRef(false);
  const initializedRef = useRef(false);
  const lastConversationIdRef = useRef<string | undefined>(undefined);

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

  // Load conversation ID from URL - FIXED to not redirect
  useEffect(() => {
    // Skip if we're currently navigating
    if (isNavigatingRef.current) {
      return;
    }

    const pathSegments = pathname.split('/').filter(Boolean);
    const conversationId = pathSegments[0];
    
    const newConversationId = conversationId && conversationId.length > 0 
      ? conversationId 
      : undefined;

    // Only update state if the conversation ID actually changed
    if (newConversationId !== lastConversationIdRef.current) {
      console.log('URL conversation ID changed:', newConversationId);
      lastConversationIdRef.current = newConversationId;
      setSelectedConversationId(newConversationId);
    }
  }, [pathname]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const handleUserChange = useCallback((newUser: User | null) => {
    setUser(newUser);
    setSelectedConversationId(undefined);
    lastConversationIdRef.current = undefined;
    
    // Navigate to home if not already there
    if (pathname !== '/' && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push('/');
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

  const handleConversationSelect = useCallback((conversationId: string) => {
    const targetPath = `/${conversationId}`;
    
    console.log('Conversation selected:', conversationId);
    console.log('Current path:', pathname);
    console.log('Target path:', targetPath);
    
    // Update state immediately
    lastConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    
    // Only navigate if we're not already at this path
    if (pathname !== targetPath && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push(targetPath);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

  const handleNewChat = useCallback(() => {
    console.log('New chat requested');
    
    // Clear conversation state
    lastConversationIdRef.current = undefined;
    setSelectedConversationId(undefined);
    
    // Only navigate if not already at home
    if (pathname !== '/' && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push('/');
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    const targetPath = `/${conversationId}`;
    
    console.log('New conversation created:', conversationId);
    
    // Update state first
    lastConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    
    // Trigger sidebar refresh - use callback to prevent unnecessary re-renders
    setRefreshConversations((prev) => prev + 1);
    
    // Only navigate if not already at this conversation
    if (pathname !== targetPath && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push(targetPath);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

  // Show loading state while initializing
  if (userLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#201d26]">
        <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
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
      
      <div className="flex-1 flex flex-col">
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