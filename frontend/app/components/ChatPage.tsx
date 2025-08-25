// ChatPage.tsx - Updated with better conversation management and immediate sidebar updates
import React, { useState } from 'react';
import Sidebar from '../components/SideBar';
import ChatInterface from '../components/ChatInterface';
import type { User } from '../types';

const ChatPage: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [refreshConversations, setRefreshConversations] = useState(0); // Trigger for refreshing conversations

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
    // Clear selected conversation when user changes
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
    // Set the newly created conversation as selected
    setSelectedConversationId(conversationId);
    // Trigger conversation list refresh
    setRefreshConversations(prev => prev + 1);
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
        refreshTrigger={refreshConversations} // Pass refresh trigger
      />
      <ChatInterface 
        user={user}
        selectedConversationId={selectedConversationId}
        onConversationCreated={handleConversationCreated}
        onNewChatStarted={handleNewChat}
      />
    </div>
  );
};

export default ChatPage;