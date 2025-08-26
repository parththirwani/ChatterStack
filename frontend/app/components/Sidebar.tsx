// frontend/app/components/Sidebar.tsx
import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Search,
  Plus,
  LogOut,
  User,
  ChevronLeft,
  ChevronRight,
  LogIn,
  Trash2,
} from 'lucide-react';
import LoginModal from './AuthModal';
import Image from 'next/image';
import { ApiService } from '../services/api';
import type { User as UserType, Conversation } from '../types';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user?: UserType | null;
  onUserChange?: (user: UserType | null) => void;
  onConversationSelect?: (conversationId: string) => void;
  onNewChat?: () => void;
  currentConversationId?: string;
  refreshTrigger?: number;
}

interface TooltipButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  className?: string;
}

const TooltipButton: React.FC<TooltipButtonProps> = ({
  icon,
  tooltip,
  onClick,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-white/10 hover:scale-105 active:scale-95 ${className}`}
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="absolute left-16 top-1/2 transform -translate-y-1/2 z-50">
          <div className="bg-gray-800 text-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium whitespace-nowrap border border-gray-600">
            {tooltip}
            <div className="absolute left-0 top-1/2 transform -translate-x-1 -translate-y-1/2 w-2 h-2 bg-gray-800 border-l border-b border-gray-600 rotate-45"></div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  formatDate: (date: string) => string;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onClick,
  onDelete,
  formatDate,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;

    const confirmed = window.confirm(
      'Are you sure you want to delete this conversation?'
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDelete();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      alert('Failed to delete conversation. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group relative p-4 rounded-2xl transition-all duration-200 cursor-pointer border ${
        isActive
          ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
          : 'bg-gray-800/30 hover:bg-gray-700/40 border-gray-600/20 hover:border-gray-500/30'
      } ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0 pr-2">
          <p
            className={`text-sm font-medium mb-1 truncate ${
              isActive ? 'text-yellow-300' : 'text-white'
            }`}
          >
            {conversation.title || 'New Chat'}
          </p>
          <p className="text-xs text-gray-400 mb-2 line-clamp-2">
            {conversation.messages[0]?.content?.substring(0, 100) ||
              'No messages'}
          </p>
          <p className="text-xs text-gray-500">
            {formatDate(conversation.updatedAt)}
          </p>
        </div>
        {/* Delete button - shows on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-start">
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
            title="Delete conversation"
          >
            {isDeleting ? (
              <div className="w-4 h-4 border border-red-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

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

  useEffect(() => {
    if (user && user.id !== 'guest') {
      loadConversations();
    } else {
      setConversations([]);
    }
  }, [user, refreshTrigger]);

  const loadConversations = async () => {
    if (!user || user.id === 'guest') return;
    setLoadingConversations(true);
    try {
      const convos = await ApiService.getConversations();
      setConversations(
        convos.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() -
            new Date(a.updatedAt).getTime()
        )
      );
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoadingConversations(false);
    }
  };

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

  const handleLoginSuccess = (authenticatedUser: UserType) => {
    if (onUserChange) onUserChange(authenticatedUser);
    setShowLoginModal(false);
  };

  const handleLogout = async () => {
    try {
      await ApiService.logout();
      if (onUserChange) onUserChange(null);
      setConversations([]);
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
        } h-full transition-all duration-300 ease-in-out flex flex-col border-r border-gray-700`}
        style={{ backgroundColor: '#141017' }}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            {collapsed ? (
              <div
                className="relative group cursor-pointer"
                onClick={onToggleCollapse}
              >
                <Image
                  src="/logo.png"
                  alt="Logo"
                  width={32}
                  height={32}
                  className="transition-opacity duration-200 group-hover:opacity-0"
                />
                <ChevronRight className="absolute inset-0 w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              </div>
            ) : (
              <>
                <div className="flex items-center space-x-2">
                  <Image src="/logo.png" alt="Logo" width={32} height={32} />
                  <h2 className="text-xl font-bold text-white">
                    Chatter<span className="text-yellow-500">Stack</span>
                  </h2>
                </div>
                <button
                  onClick={onToggleCollapse}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors duration-200 text-white hover:text-yellow-500"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-b border-gray-700">
          {collapsed ? (
            <div className="space-y-3 flex flex-col items-center">
              <TooltipButton
                icon={<Plus className="w-5 h-5 text-black" />}
                tooltip="New Chat"
                onClick={handleNewChat}
                className="bg-yellow-500 hover:bg-yellow-400 text-black"
              />
              {isAuthenticated && (
                <TooltipButton
                  icon={<Search className="w-5 h-5 text-white" />}
                  tooltip="Search Chats"
                  onClick={() => {}}
                  className="text-white hover:bg-white/10"
                />
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleNewChat}
                className="w-full flex items-center justify-center space-x-3 px-4 py-3 rounded-lg bg-yellow-500 hover:bg-yellow-400 transition-all duration-200 text-black font-medium hover:scale-105 active:scale-95"
              >
                <Plus className="w-5 h-5" />
                <span className="font-medium">New Chat</span>
              </button>
              {isAuthenticated && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search chats..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-800/50 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder-gray-400 border border-gray-600/30 hover:border-gray-500/50 focus:border-yellow-500/50 focus:outline-none transition-colors"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat History */}
        {!collapsed && isAuthenticated && (
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
              Recent Chats
            </h3>
            {loadingConversations ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : filteredConversations.length > 0 ? (
              <div className="space-y-3">
                {filteredConversations.slice(0, 20).map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={currentConversationId === conversation.id}
                    onClick={() => handleConversationClick(conversation.id)}
                    onDelete={() =>
                      handleDeleteConversation(conversation.id)
                    }
                    formatDate={formatDate}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 text-sm">No conversations yet</p>
                <p className="text-gray-500 text-xs">
                  Start a new chat to see it here
                </p>
              </div>
            )}
          </div>
        )}

        {/* User Section */}
        <div className="mt-auto p-4 border-t border-gray-700/50">
          {isAuthenticated ? (
            collapsed ? (
              <div className="flex flex-col items-center space-y-3">
                <TooltipButton
                  icon={
                    user?.avatarUrl ? (
                      <Image
                        src={user.avatarUrl}
                        alt={user.name || 'User'}
                        width={32}
                        height={32}
                        className="w-8 h-8 rounded-full"
                      />
                    ) : (
                      <User className="w-5 h-5 text-white" />
                    )
                  }
                  tooltip={user?.name || user?.email || 'User Profile'}
                  onClick={() => {}}
                />
                <TooltipButton
                  icon={<LogOut className="w-5 h-5 text-red-400" />}
                  tooltip="Sign Out"
                  onClick={handleLogout}
                  className="hover:bg-red-500/10"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-gray-800/30 border border-gray-600/20">
                  {user?.avatarUrl ? (
                    <Image
                      src={user.avatarUrl}
                      alt={user.name || 'User'}
                      width={40}
                      height={40}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center">
                      <User className="w-5 h-5 text-black" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {user?.name || 'User'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {user?.email || `Signed in with ${user?.provider}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-red-500/10 transition-colors text-red-400 hover:text-red-300"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Logout</span>
                </button>
              </div>
            )
          ) : (
            <button
              onClick={handleLoginClick}
              className={`${
                collapsed ? 'w-12 h-12' : 'w-full px-4 py-3'
              } flex items-center justify-center space-x-3 rounded-lg bg-yellow-500 hover:bg-yellow-400 transition-colors text-black font-medium`}
            >
              <LogIn className="w-5 h-5" />
              {!collapsed && <span>Login</span>}
            </button>
          )}
        </div>
      </div>

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </>
  );
};

export default Sidebar;
