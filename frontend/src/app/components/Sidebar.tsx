import React, { useState, useCallback, memo } from 'react';
import LoginModal from './AuthModal';
import type { User } from '../types';
import ChatHistory from './Sidebar/ChatHistory';
import SidebarActionButtons from './Sidebar/SidebarActionButton';
import SidebarHeader from './Sidebar/SidebarHeader';
import UserSection from './Sidebar/UserSection';
import { useAppStore } from '../store/useAppStore';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user?: User | null;
  onUserChange?: (user: User | null) => void;
  onConversationSelect?: (conversationId: string) => void;
  onNewChat?: () => void;
  currentConversationId?: string;
}

const SidebarOptimized: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  user = null,
  onUserChange,
  onConversationSelect,
  onNewChat,
  currentConversationId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  
  // Get conversations and loading state from Zustand
  const conversations = useAppStore((state) => state.conversations);
  const conversationsLoading = useAppStore((state) => state.conversationsLoading);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const logout = useAppStore((state) => state.logout);

  const handleDeleteConversation = useCallback(async (conversationId: string) => {
    try {
      await deleteConversation(conversationId);
      
      if (currentConversationId === conversationId && onNewChat) {
        onNewChat();
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  }, [currentConversationId, onNewChat, deleteConversation]);

  const handleNewChat = useCallback(() => {
    if (onNewChat) onNewChat();
  }, [onNewChat]);

  const handleConversationClick = useCallback((conversationId: string) => {
    if (onConversationSelect) onConversationSelect(conversationId);
  }, [onConversationSelect]);

  const handleLoginClick = useCallback(() => {
    setShowLoginModal(true);
  }, []);

  const handleLoginSuccess = useCallback((authenticatedUser: User | null) => {
    if (onUserChange) onUserChange(authenticatedUser);
    setShowLoginModal(false);
  }, [onUserChange]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      if (onUserChange) onUserChange(null);
    } catch (err) {
      console.error('Error logging out', err);
    }
  }, [logout, onUserChange]);

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  }, []);

  const filteredConversations = React.useMemo(() => {
    return conversations.filter(
      (conv) =>
        conv.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conv.messages.some((msg) =>
          msg.content.toLowerCase().includes(searchQuery.toLowerCase())
        )
    );
  }, [conversations, searchQuery]);

  const isAuthenticated = user && user.id && user.id !== 'guest';

  return (
    <>
      <div
        className={`${
          collapsed ? 'w-20' : 'w-80'
        } h-screen flex-shrink-0 transition-all duration-300 ease-in-out flex flex-col border-r border-gray-700`}
        style={{ backgroundColor: '#141017' }}
      >
        <SidebarHeader
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />

        <SidebarActionButtons
          collapsed={collapsed}
          isAuthenticated={!!isAuthenticated}
          searchQuery={searchQuery}
          onNewChat={handleNewChat}
          onSearchChange={setSearchQuery}
        />

        {!collapsed && isAuthenticated && (
          <MemoizedChatHistory
            loadingConversations={conversationsLoading}
            filteredConversations={filteredConversations}
            currentConversationId={currentConversationId}
            onConversationClick={handleConversationClick}
            onDeleteConversation={handleDeleteConversation}
            formatDate={formatDate}
          />
        )}

        <UserSection
          user={user}
          collapsed={collapsed}
          isAuthenticated={!!isAuthenticated}
          onLoginClick={handleLoginClick}
          onLogout={handleLogout}
        />
      </div>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </>
  );
};

// Memoize ChatHistory to prevent unnecessary re-renders
const MemoizedChatHistory = memo(ChatHistory, (prev, next) => {
  return (
    prev.loadingConversations === next.loadingConversations &&
    prev.currentConversationId === next.currentConversationId &&
    prev.filteredConversations.length === next.filteredConversations.length &&
    JSON.stringify(prev.filteredConversations) === JSON.stringify(next.filteredConversations)
  );
});

MemoizedChatHistory.displayName = 'MemoizedChatHistory';

export default memo(SidebarOptimized, (prev, next) => {
  return (
    prev.collapsed === next.collapsed &&
    prev.user?.id === next.user?.id &&
    prev.currentConversationId === next.currentConversationId
  );
});