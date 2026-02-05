import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
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
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRefreshTriggerRef = useRef<number>(refreshTrigger);

  const loadConversations = useCallback(async (immediate = false) => {
    // Don't load if not authenticated or already loading
    if (!user || user.id === 'guest' || isLoadingRef.current) {
      if (!user || user.id === 'guest') {
        setConversations([]);
        setLoadingConversations(false);
        hasLoadedRef.current = false;
      }
      return;
    }

    // Clear any pending timeout
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }

    const loadFn = async () => {
      // Check if we need to show loading state
      const userChanged = previousUserIdRef.current !== user.id;
      const shouldShowLoading = !hasLoadedRef.current || userChanged;
      
      isLoadingRef.current = true;
      
      if (shouldShowLoading) {
        setLoadingConversations(true);
      }

      try {
        const convos = await ApiService.getConversations();
        
        // Use functional update to prevent stale state
        setConversations((prevConvos) => {
          const sortedConvos = convos.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() -
              new Date(a.updatedAt).getTime()
          );
          
          // Only update if conversations actually changed
          if (JSON.stringify(prevConvos) === JSON.stringify(sortedConvos)) {
            return prevConvos;
          }
          
          return sortedConvos;
        });
        
        hasLoadedRef.current = true;
        previousUserIdRef.current = user.id;
      } catch (error) {
        console.error('Failed to load conversations:', error);
        setConversations([]);
      } finally {
        setLoadingConversations(false);
        isLoadingRef.current = false;
      }
    };

    // Debounce the load unless it's immediate or first load
    if (immediate || !hasLoadedRef.current) {
      loadFn();
    } else {
      // Debounce subsequent loads to prevent flickering
      loadTimeoutRef.current = setTimeout(loadFn, 300);
    }
  }, [user]);

  // Load conversations when user ID changes
  useEffect(() => {
    const userId = user?.id;
    if (userId && userId !== 'guest') {
      loadConversations(true);
    }
  }, [user?.id, loadConversations]);

  // Handle refresh trigger with debouncing
  useEffect(() => {
    if (refreshTrigger !== lastRefreshTriggerRef.current) {
      lastRefreshTriggerRef.current = refreshTrigger;
      
      // Only reload if user is authenticated
      if (user && user.id && user.id !== 'guest') {
        // Debounce the refresh to prevent flickering when new conversation is created
        loadConversations(false);
      }
    }
  }, [refreshTrigger, user, loadConversations]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, []);

  const handleDeleteConversation = useCallback(async (conversationId: string) => {
    try {
      await ApiService.deleteConversation(conversationId);
      
      // Optimistically update UI
      setConversations((prev) =>
        prev.filter((conv) => conv.id !== conversationId)
      );
      
      if (currentConversationId === conversationId && onNewChat) {
        onNewChat();
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      // Reload conversations on error
      loadConversations(true);
      throw error;
    }
  }, [currentConversationId, onNewChat, loadConversations]);

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
      await ApiService.logout();
      if (onUserChange) onUserChange(null);
      setConversations([]);
      hasLoadedRef.current = false;
      previousUserIdRef.current = undefined;
    } catch (err) {
      console.error('Error logging out', err);
    }
  }, [onUserChange]);

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

export default memo(Sidebar, (prev, next) => {
  return (
    prev.collapsed === next.collapsed &&
    prev.user?.id === next.user?.id &&
    prev.currentConversationId === next.currentConversationId &&
    prev.refreshTrigger === next.refreshTrigger
  );
});