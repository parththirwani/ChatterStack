import React, { useState, useEffect } from 'react';
import { LayoutGrid, LayoutList } from 'lucide-react';
import ChatInterface from './ChatInterface/ChatInterface';
import type { User } from '../types';
import Sidebar from './Sidebar';

const ChatPage: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [refreshConversations, setRefreshConversations] = useState(0);
  const [viewMode, setViewMode] = useState<'all' | string>('all');

  // Load conversation ID from URL on mount
  useEffect(() => {
    const path = window.location.pathname;
    const conversationId = path.split('/').filter(Boolean)[0]; // Get first path segment
    
    if (conversationId && conversationId.length > 0) {
      console.log('=== ChatPage: Loading conversation from URL ===');
      console.log('Conversation ID from URL:', conversationId);
      setSelectedConversationId(conversationId);
    }
  }, []);

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
    setSelectedConversationId(undefined);
    // Reset URL to home when user changes
    window.history.pushState({}, '', '/');
  };

  const handleConversationSelect = (conversationId: string) => {
    console.log('=== ChatPage: Conversation Selected ===');
    console.log('Selected conversation ID:', conversationId);
    console.log('Current conversation ID:', selectedConversationId);
    setSelectedConversationId(conversationId);
    
    // Update URL without reloading page
    window.history.pushState({}, '', `/${conversationId}`);
  };

  const handleNewChat = () => {
    console.log('=== ChatPage: New Chat Started ===');
    setSelectedConversationId(undefined);
    
    // Reset URL to home
    window.history.pushState({}, '', '/');
  };

  const handleConversationCreated = (conversationId: string) => {
    console.log('=== ChatPage: New Conversation Created ===');
    console.log('New conversation ID:', conversationId);
    setSelectedConversationId(conversationId);
    setRefreshConversations((prev) => prev + 1);
    
    // Update URL with new conversation ID
    window.history.pushState({}, '', `/${conversationId}`);
  };

  const toggleViewMode = () => {
    setViewMode((prev) =>
      prev === 'all' ? 'deepseek/deepseek-chat-v3.1' : 'all'
    );
  };

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const conversationId = path.split('/').filter(Boolean)[0];
      
      if (conversationId) {
        console.log('=== ChatPage: Browser navigation detected ===');
        console.log('Loading conversation:', conversationId);
        setSelectedConversationId(conversationId);
      } else {
        console.log('=== ChatPage: Browser navigation to home ===');
        setSelectedConversationId(undefined);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[#201d26]">
      <div className="flex-shrink-0">
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
      </div>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex-shrink-0 flex items-center justify-end px-6 py-4 bg-[#201d26] backdrop-blur-md border-b border-gray-700/50">
          <button
            onClick={toggleViewMode}
            className="p-2 rounded-full text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-all duration-200"
            title={viewMode === 'all' ? 'Switch to single model view' : 'Switch to all models view'}
          >
            {viewMode === 'all' ? (
              <LayoutList className="w-5 h-5" />
            ) : (
              <LayoutGrid className="w-5 h-5" />
            )}
          </button>
        </header>
        <div className="flex-1 overflow-hidden">
          <ChatInterface
            user={user}
            selectedConversationId={selectedConversationId}
            onConversationCreated={handleConversationCreated}
            onNewChatStarted={handleNewChat}
            viewMode={viewMode}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatPage;