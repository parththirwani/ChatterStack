// ChatPage.tsx - Updated to handle conversation selection
import React, { useState } from 'react';
import Sidebar from '../components/SideBar';
import ChatInterface from '../components/ChatInterface';
import type { User } from '../types';

const ChatPage: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
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

  return (
    <div className="flex h-screen bg-gray-900">
      <Sidebar 
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        user={user}
        onUserChange={handleUserChange}
        onConversationSelect={handleConversationSelect}
        onNewChat={handleNewChat}
        currentConversationId={selectedConversationId}
      />
      <ChatInterface 
        user={user}
        selectedConversationId={selectedConversationId}
      />
    </div>
  );
};

export default ChatPage;