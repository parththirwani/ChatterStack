import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import CoucilChatInterface from './CouncilChatInterface';
import type { User } from '../../types';
import Sidebar from '../Sidebar';
import { ApiService } from '../../services/api';
import CouncilChatInterface from './CouncilChatInterface';

const CouncilPage: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [refreshConversations, setRefreshConversations] = useState(0);

  const isNavigatingRef = useRef(false);
  const initializedRef = useRef(false);
  const lastConversationIdRef = useRef<string | undefined>(undefined);

  // Initialize user
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

  // Load conversation ID from URL
  useEffect(() => {
    if (isNavigatingRef.current) {
      return;
    }

    const pathSegments = pathname.split('/').filter(Boolean);
    const conversationId = pathSegments[1]; // council/[id]
    
    const newConversationId = conversationId && conversationId.length > 0 
      ? conversationId 
      : undefined;

    if (newConversationId !== lastConversationIdRef.current) {
      console.log('Council URL conversation ID changed:', newConversationId);
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
    
    if (pathname !== '/council' && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push('/council');
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

  const handleConversationSelect = useCallback((conversationId: string) => {
    const targetPath = `/council/${conversationId}`;
    
    console.log('Council conversation selected:', conversationId);
    
    lastConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    
    if (pathname !== targetPath && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push(targetPath);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

  const handleNewChat = useCallback(() => {
    console.log('New council chat requested');
    
    lastConversationIdRef.current = undefined;
    setSelectedConversationId(undefined);
    
    if (pathname !== '/council' && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push('/council');
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    const targetPath = `/council/${conversationId}`;
    
    console.log('New council conversation created:', conversationId);
    
    lastConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    setRefreshConversations((prev) => prev + 1);
    
    if (pathname !== targetPath && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push(targetPath);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  }, [pathname, router]);

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
        <MemoizedCouncilChatInterface
          selectedConversationId={selectedConversationId}
          onConversationCreated={handleConversationCreated}
        />
      </div>
    </div>
  );
};

const MemoizedCouncilChatInterface = memo(CouncilChatInterface, (prev, next) => {
  return prev.selectedConversationId === next.selectedConversationId;
});

const MemoizedSidebar = memo(Sidebar, (prev, next) => {
  return (
    prev.collapsed === next.collapsed &&
    prev.user?.id === next.user?.id &&
    prev.currentConversationId === next.currentConversationId &&
    prev.refreshTrigger === next.refreshTrigger
  );
});

MemoizedCouncilChatInterface.displayName = 'MemoizedCouncilChatInterface';
MemoizedSidebar.displayName = 'MemoizedSidebar';

export default memo(CouncilPage);