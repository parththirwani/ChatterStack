import React, { useState, useCallback, memo } from 'react';
import LoginModal from '@/src/components/auth/AuthModal';
import type { User } from '@/src/types/user.types';
import ChatHistory from '@/src/components/sidebar/history/ChatHistory';
import SidebarActionButtons from '@/src/components/sidebar/actions/SidebarActionButton';
import SidebarHeader from '@/src/components/sidebar/header/SidebarHeader';
import UserSection from '@/src/components/sidebar/user/UserSection';
import { useAppStore } from '@/src/store/rootStore';

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
    if (!searchQuery.trim()) {
      return conversations;
    }
    
    return conversations.filter((conv) => {
      // Search in title
      if (conv.title?.toLowerCase().includes(searchQuery.toLowerCase())) {
        return true;
      }
      
      // Search in messages (safely handle undefined messages array)
      if (conv.messages && Array.isArray(conv.messages)) {
        return conv.messages.some((msg: { content: string; }) =>
          msg.content?.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      
      return false;
    });
  }, [conversations, searchQuery]);

  const isAuthenticated = user && user.id && user.id !== 'guest';

  return (
    <>
      <div
        className={`${
          collapsed ? 'w-20' : 'w-80'
        } h-screen shrink-0 transition-all duration-300 ease-in-out flex flex-col border-r border-gray-700`}
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