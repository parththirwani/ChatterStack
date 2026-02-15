import React, { useState, useCallback, memo } from 'react';
import LoginModal from '@/src/components/auth/AuthModal';
import type { User } from '@/src/types/user.types';
import ChatHistory from '@/src/components/sidebar/history/ChatHistory';
import SidebarActionButtons from '@/src/components/sidebar/actions/SidebarActionButton';
import SidebarHeader from '@/src/components/sidebar/header/SidebarHeader';
import UserSection from '@/src/components/sidebar/user/UserSection';
import { useAppStore } from '@/src/store/rootStore';
import { Crown } from 'lucide-react';

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
  refreshTrigger,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  
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
    <>
      <div
        className={`${
          collapsed ? 'w-20' : 'w-80'
        } h-screen shrink-0 transition-all duration-300 ease-in-out flex flex-col border-r border-gray-700/50 gradient-dark`}
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

        {/* Premium Upgrade Banner */}
        {!collapsed && isAuthenticated && (
          <div className="px-4 pb-4">
            <div className="bg-gradient-to-br from-yellow-500/15 to-yellow-600/10 border border-yellow-500/20 rounded-xl p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="bg-yellow-500 text-black px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1">
                  <Crown className="w-3 h-3" />
                  20 days left
                </div>
              </div>
              <p className="text-xs text-gray-300 mb-3 leading-relaxed">
                Upgrade to premium and enjoy the benefits for a long time
              </p>
              <button className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-black font-semibold text-sm py-2.5 rounded-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-yellow-500/30">
                View Plan
              </button>
            </div>
          </div>
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
    prev.currentConversationId === next.currentConversationId &&
    prev.refreshTrigger === next.refreshTrigger
  );
});