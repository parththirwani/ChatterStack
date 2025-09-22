import React, { useState } from 'react';
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

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
    setSelectedConversationId(undefined);
  };

  const handleConversationSelect = (conversationId: string) => {
    console.log('=== ChatPage: Conversation Selected ===');
    console.log('Selected conversation ID:', conversationId);
    console.log('Current conversation ID:', selectedConversationId);
    setSelectedConversationId(conversationId);
  };

  const handleNewChat = () => {
    console.log('=== ChatPage: New Chat Started ===');
    setSelectedConversationId(undefined);
  };

  const handleConversationCreated = (conversationId: string) => {
    console.log('=== ChatPage: New Conversation Created ===');
    console.log('New conversation ID:', conversationId);
    setSelectedConversationId(conversationId);
    setRefreshConversations((prev) => prev + 1);
  };

  const toggleViewMode = () => {
    setViewMode((prev) =>
      prev === 'all' ? 'deepseek/deepseek-chat-v3.1' : 'all'
    );
  };

  return (
    <div className="flex h-screen bg-[#201d26]">
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
        <header className="flex items-center justify-end px-6 py-4 bg-[#201d26] backdrop-blur-md border-b border-gray-700/50">
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
        <ChatInterface
          user={user}
          selectedConversationId={selectedConversationId}
          onConversationCreated={handleConversationCreated}
          onNewChatStarted={handleNewChat}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
};

export default ChatPage;