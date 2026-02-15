import React, { useState, useCallback, memo } from 'react';
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
  refreshTrigger?: number;
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
    // UserSection now handles the modal
  }, []);

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
      if (conv.title?.toLowerCase().includes(searchQuery.toLowerCase())) {
        return true;
      }
      
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
    <div
      className={`
        ${collapsed ? 'w-16' : 'w-72'} 
        h-screen 
        shrink-0 
        transition-all duration-300 ease-in-out 
        flex flex-col 
        bg-[#1a1721]
        border-r border-gray-800/50
        overflow-hidden
      `}
    >
      {/* Header - Clean minimal design with original colors */}
      <div className={`${collapsed ? 'px-2 py-4' : 'px-4 py-4'}`}>
        <SidebarHeader
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
      </div>

      {/* Action Buttons - No border, cleaner spacing */}
      <div className={`${collapsed ? 'px-2' : 'px-4'} pb-4`}>
        <SidebarActionButtons
          collapsed={collapsed}
          isAuthenticated={!!isAuthenticated}
          searchQuery={searchQuery}
          onNewChat={handleNewChat}
          onSearchChange={setSearchQuery}
        />
      </div>

      {/* Subtle gradient divider */}
      {!collapsed && isAuthenticated && (
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
      )}

      {/* Chat History - Clean scrollable area OR Spacer for collapsed mode */}
      {!collapsed && isAuthenticated ? (
        <div className="flex-1 overflow-y-auto min-h-0 px-2">
          <MemoizedChatHistory
            loadingConversations={conversationsLoading}
            filteredConversations={filteredConversations}
            currentConversationId={currentConversationId}
            onConversationClick={handleConversationClick}
            onDeleteConversation={handleDeleteConversation}
            formatDate={formatDate}
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Subtle gradient divider before user section */}
      {!collapsed && (
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
      )}

      {/* User Section - Clean, no heavy border */}
      <div className={`${collapsed ? 'p-2' : 'p-4'} shrink-0`}>
        <UserSection
          user={user}
          collapsed={collapsed}
          isAuthenticated={!!isAuthenticated}
          onLoginClick={handleLoginClick}
          onLogout={handleLogout}
        />
      </div>
    </div>
  );
};

const MemoizedChatHistory = memo(ChatHistory, (prev, next) => {
  if (prev.filteredConversations && next.filteredConversations) {
    return (
      prev.loadingConversations === next.loadingConversations &&
      prev.currentConversationId === next.currentConversationId &&
      prev.filteredConversations.length === next.filteredConversations.length &&
      JSON.stringify(prev.filteredConversations) === JSON.stringify(next.filteredConversations)
    );
  }
  
  return (
    prev.loadingConversations === next.loadingConversations &&
    prev.currentConversationId === next.currentConversationId
  );
});

MemoizedChatHistory.displayName = 'MemoizedChatHistory';

export default memo(SidebarOptimized, (prev, next) => {
  return (
    prev.collapsed === next.collapsed &&
    prev.user?.id === next.user?.id &&
    prev.currentConversationId === next.currentConversationId &&
    prev.refreshTrigger === next.refreshTrigger
  );
});