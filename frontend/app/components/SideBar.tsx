import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Search, 
  Plus, 
  Settings, 
  LogOut, 
  User,
  ChevronLeft,
  ChevronRight,
  LogIn
} from 'lucide-react';
import LoginModal from './AuthModal';
import Image from 'next/image';

type User = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
};

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user?: User | null;
  onUserChange?: (user: User | null) => void;
}

interface TooltipButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  className?: string;
}

const TooltipButton: React.FC<TooltipButtonProps> = ({ icon, tooltip, onClick, className = "" }) => {
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

const Sidebar: React.FC<SidebarProps> = ({ 
  collapsed, 
  onToggleCollapse, 
  user = null, 
  onUserChange 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
      window.history.replaceState({}, document.title, window.location.pathname);
      validateUser();
    }
  }, []);

  const validateUser = async () => {
    try {
      const response = await fetch('http://localhost:3000/auth/validate', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.user && onUserChange) {
          onUserChange(data.user);
        }
      }
    } catch (error) {
      console.error('Error validating user:', error);
    }
  };

  const handleNewChat = () => {};
  const handleSearchChat = () => {};
  const handleLoginClick = () => setShowLoginModal(true);

  const handleLoginSuccess = (authenticatedUser: User) => {
    if (onUserChange) onUserChange(authenticatedUser);
    setShowLoginModal(false);
  };

  const handleLogout = async () => {
    try {
      await fetch(`http://localhost:3000/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (onUserChange) onUserChange(null);
    } catch (err) {
      console.error("Error logging out", err);
    }
  };

  const isAuthenticated = user && user.id && user.id !== 'guest';

  return (
    <>
      <div className={`${collapsed ? 'w-20' : 'w-80'} h-full transition-all duration-300 ease-in-out flex flex-col border-r border-gray-700`} 
           style={{ backgroundColor: '#141017' }}>
        
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            {!collapsed && (
              <h2 className="text-xl font-bold text-white">
                Chatter<span className="text-yellow-500">Stack</span>
              </h2>
            )}
            <button
              onClick={onToggleCollapse}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors duration-200 text-white hover:text-yellow-500"
            >
              {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
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
              <TooltipButton
                icon={<Search className="w-5 h-5 text-white" />}
                tooltip="Search Chats"
                onClick={handleSearchChat}
                className="text-white hover:bg-white/10"
              />
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
            </div>
          )}
        </div>

        {/* Chat History */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
              Recent Chats
            </h3>
            <div className="space-y-3">
              {["Getting Started with AI", "Project Planning", "Code Review", "Design Feedback"].map((title, i) => (
                <div key={i} className="p-4 rounded-2xl bg-gray-800/30 hover:bg-gray-700/40 transition-all duration-200 cursor-pointer border border-gray-600/20 hover:border-gray-500/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white mb-1 truncate">{title}</p>
                    <p className="text-xs text-gray-400 mb-2 line-clamp-2">Sample preview text...</p>
                    <p className="text-xs text-gray-500">Some time ago</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Settings */}
        <div className="p-4 border-t border-gray-700/50">
          {collapsed ? (
            <div className="flex justify-center">
              <TooltipButton
                icon={<Settings className="w-5 h-5 text-gray-400" />}
                tooltip="Settings"
                onClick={() => {}}
                className="hover:bg-gray-700/30"
              />
            </div>
          ) : (
            <button
              onClick={() => {}}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-700/30 transition-all duration-200 text-gray-400 hover:text-white"
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">Settings</span>
            </button>
          )}
        </div>

        {/* User Section */}
        <div className="p-4 border-t border-gray-700/50">
          {isAuthenticated ? (
            collapsed ? (
              <div className="flex flex-col items-center space-y-3">
                <TooltipButton
                  icon={user?.avatarUrl ? (
                    <Image
                      src={user.avatarUrl}
                      alt={user.name || 'User'} 
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <User className="w-5 h-5 text-white" />
                  )}
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
                    <p className="text-sm font-medium text-white truncate">{user?.name || 'User'}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email || `Signed in with ${user?.provider}`}</p>
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
              className={`${collapsed ? 'w-12 h-12' : 'w-full px-4 py-3'} flex items-center justify-center space-x-3 rounded-lg bg-yellow-500 hover:bg-yellow-400 transition-colors text-black font-medium`}
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
