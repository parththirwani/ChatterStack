"use client"
import React, { useState, useEffect } from 'react';
import Sidebar from './SideBar';
import ChatInterface from './ChatInterface';

type User = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
};

interface ChatterStackPageProps {
  user: User | null;
  onUserChange: (user: User | null) => void;
  onCallChat: () => Promise<void>;
  loading: boolean;
}

const ChatterStackPage: React.FC<ChatterStackPageProps> = ({ 
  user, 
  onUserChange, 
  onCallChat, 
  loading 
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isFirstMessage, setIsFirstMessage] = useState(true);

  const handleFirstMessage = () => {
    setIsFirstMessage(false);
  };

  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className="flex h-screen text-white" style={{ backgroundColor: '#221c24' }}>
      <Sidebar 
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        user={user}
        onUserChange={onUserChange}
      />
      <ChatInterface
        isFirstMessage={isFirstMessage}
        onFirstMessage={handleFirstMessage}
      />
    </div>
  );
};
export default ChatterStackPage;