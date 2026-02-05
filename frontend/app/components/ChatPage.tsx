import React, { useState, useEffect, useRef } from 'react';
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

  // Use ref to prevent navigation loops
  const isNavigatingRef = useRef(false);
  const initializedRef = useRef(false);

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

  // Load conversation ID from URL - only update state if it's different
  useEffect(() => {
    const pathSegments = pathname.split('/').filter(Boolean);
    const conversationId = pathSegments[0];
    
    const newConversationId = conversationId && conversationId.length > 0 
      ? conversationId 
      : undefined;

    // Only update if different to prevent unnecessary re-renders
    if (newConversationId !== selectedConversationId) {
      console.log('URL changed, loading conversation:', newConversationId);
      setSelectedConversationId(newConversationId);
    }
  }, [pathname]);

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
    setSelectedConversationId(undefined);
    
    // Navigate to home if not already there
    if (pathname !== '/' && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push('/');
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  };

  const handleConversationSelect = (conversationId: string) => {
    const targetPath = `/${conversationId}`;
    
    // Only navigate if we're not already at this path
    if (pathname !== targetPath && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      setSelectedConversationId(conversationId);
      router.push(targetPath);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  };

  const handleNewChat = () => {
    // Only navigate if not already at home
    if (pathname !== '/' && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      setSelectedConversationId(undefined);
      router.push('/');
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    } else {
      // Just clear the conversation if already at home
      setSelectedConversationId(undefined);
    }
  };

  const handleConversationCreated = (conversationId: string) => {
    const targetPath = `/${conversationId}`;
    
    setSelectedConversationId(conversationId);
    setRefreshConversations((prev) => prev + 1);
    
    // Only navigate if not already at this conversation
    if (pathname !== targetPath && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.push(targetPath);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 100);
    }
  };

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
      <Sidebar
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
        <ChatInterface
          selectedConversationId={selectedConversationId}
          onConversationCreated={handleConversationCreated}
        />
      </div>
    </div>
  );
};

export default ChatPage;