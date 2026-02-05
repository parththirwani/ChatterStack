import React, { useState, useEffect, useCallback, useRef } from 'react';
import LoginModal from './AuthModal';
import { ApiService } from '../services/api';
import type { User, Conversation } from '../types';
import ChatHistory from './Sidebar/ChatHistory';
import SidebarActionButtons from './Sidebar/SidebarActionButton';
import SidebarHeader from './Sidebar/SidebarHeader';
import UserSection from './Sidebar/UserSection';

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

const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  user = null,
  onUserChange,
  onConversationSelect,
  onNewChat,
  currentConversationId,
  refreshTrigger = 0,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  
  // Track loading state to prevent flickering
  const hasLoadedRef = useRef<boolean>(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const isLoadingRef = useRef<boolean>(false);

  const loadConversations = useCallback(async () => {
    // Don't load if not authenticated or already loading
    if (!user || user.id === 'guest' || isLoadingRef.current) {
      if (!user || user.id === 'guest') {
        setConversations([]);
        setLoadingConversations(false);
        hasLoadedRef.current = false;
      }
      return;
    }

    // Check if we need to show loading state
    const userChanged = previousUserIdRef.current !== user.id;
    const shouldShowLoading = !hasLoadedRef.current || userChanged;
    
    isLoadingRef.current = true;
    
    if (shouldShowLoading) {
      setLoadingConversations(true);
    }

    try {
      const convos = await ApiService.getConversations();
      setConversations(
        convos.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() -
            new Date(a.updatedAt).getTime()
        )
      );
      hasLoadedRef.current = true;
      previousUserIdRef.current = user.id;
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setConversations([]);
    } finally {
      setLoadingConversations(false);
      isLoadingRef.current = false;
    }
  }, [user]);

  // Load conversations when user ID changes or refresh is triggered
  useEffect(() => {
    const userId = user?.id;
    if (userId && userId !== 'guest') {
      loadConversations();
    }
  }, [user?.id, refreshTrigger, loadConversations]);

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await ApiService.deleteConversation(conversationId);
      setConversations((prev) =>
        prev.filter((conv) => conv.id !== conversationId)
      );
      if (currentConversationId === conversationId && onNewChat) {
        onNewChat();
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  };

  const handleNewChat = () => {
    if (onNewChat) onNewChat();
  };

  const handleConversationClick = (conversationId: string) => {
    if (onConversationSelect) onConversationSelect(conversationId);
  };

  const handleLoginClick = () => setShowLoginModal(true);

  const handleLoginSuccess = (authenticatedUser: User | null) => {
    if (onUserChange) onUserChange(authenticatedUser);
    setShowLoginModal(false);
  };

  const handleLogout = async () => {
    try {
      await ApiService.logout();
      if (onUserChange) onUserChange(null);
      setConversations([]);
      hasLoadedRef.current = false;
      previousUserIdRef.current = undefined;
    } catch (err) {
      console.error('Error logging out', err);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const filteredConversations = conversations.filter(
    (conv) =>
      conv.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.messages.some((msg) =>
        msg.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

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
          <ChatHistory
            loadingConversations={loadingConversations}
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

export default Sidebar;