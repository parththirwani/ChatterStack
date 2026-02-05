import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, LayoutList } from 'lucide-react';
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
  const [viewMode, setViewMode] = useState<'all' | string>('all');

  // Initialize user on mount
  useEffect(() => {
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

  // Load conversation ID from URL on mount and when pathname changes
  useEffect(() => {
    console.log('=== ChatPage: Pathname changed ===');
    console.log('Current pathname:', pathname);
    
    const pathSegments = pathname.split('/').filter(Boolean);
    const conversationId = pathSegments[0];
    
    if (conversationId && conversationId.length > 0) {
      console.log('Loading conversation from URL:', conversationId);
      setSelectedConversationId(conversationId);
    } else {
      console.log('No conversation ID in URL, showing new chat');
      setSelectedConversationId(undefined);
    }
  }, [pathname]);

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
    setSelectedConversationId(undefined);
    // Only navigate if not already at home
    if (pathname !== '/') {
      router.push('/');
    }
  };

  const handleConversationSelect = (conversationId: string) => {
    console.log('=== ChatPage: Conversation Selected ===');
    console.log('Selected conversation ID:', conversationId);
    setSelectedConversationId(conversationId);
    // Only navigate if not already at this conversation
    if (pathname !== `/${conversationId}`) {
      router.push(`/${conversationId}`);
    }
  };

  const handleNewChat = () => {
    console.log('=== ChatPage: New Chat Started ===');
    setSelectedConversationId(undefined);
    // Only navigate if not already at home
    if (pathname !== '/') {
      router.push('/');
    }
  };

  const handleConversationCreated = (conversationId: string) => {
    console.log('=== ChatPage: New Conversation Created ===');
    console.log('New conversation ID:', conversationId);
    setSelectedConversationId(conversationId);
    setRefreshConversations((prev) => prev + 1);
    // Only navigate if not already at this conversation
    if (pathname !== `/${conversationId}`) {
      router.push(`/${conversationId}`);
    }
  };

  const toggleViewMode = () => {
    setViewMode((prev) => prev === 'all' ? 'deepseek/deepseek-chat-v3.1' : 'all');
  };

  // Don't render until user state is initialized
  if (userLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
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
        <div className="p-4 border-b flex justify-end">
          <button
            onClick={toggleViewMode}
            className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100"
          >
            {viewMode === 'all' ? (
              <><LayoutGrid size={20} /> All Models</>
            ) : (
              <><LayoutList size={20} /> DeepSeek Only</>
            )}
          </button>
        </div>
        
        <ChatInterface
          selectedConversationId={selectedConversationId}
          onConversationCreated={handleConversationCreated}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
};

export default ChatPage;