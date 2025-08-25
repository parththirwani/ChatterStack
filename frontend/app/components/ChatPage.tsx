"use client"
import React, { useState } from 'react';
import Sidebar from './SideBar';
import ChatInterface from './ChatInterface';
import { useAuth } from '../hooks/useAuth';
import { useChat } from '../hooks/useChat';

const ChatterStackPage: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, loading, login, logout } = useAuth();
  const { loadConversation, startNewConversation } = useChat();

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleConversationSelect = async (conversationId: string) => {
    await loadConversation(conversationId);
  };

  const handleNewChat = () => {
    startNewConversation();
  };

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: '#221c24' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen text-white" style={{ backgroundColor: '#221c24' }}>
      <Sidebar 
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        user={user}
        onUserChange={(newUser) => {
          if (newUser) {
            login(newUser);
          } else {
            logout();
          }
        }}
        onConversationSelect={handleConversationSelect}
        onNewChat={handleNewChat}
      />
      <ChatInterface user={user} />
    </div>
  );
};

export default ChatterStackPage;