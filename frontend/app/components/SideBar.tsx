import React, { useState } from 'react';
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

// Tooltip component for collapsed state buttons
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

  const handleNewChat = () => {
    console.log('New chat clicked');
    // Add your new chat logic here
  };

  const handleSearchChat = () => {
    console.log('Search chat clicked');
    // Add your search chat logic here
  };

  const handleLoginClick = () => {
    setShowLoginModal(true);
  };

  const handleLoginSuccess = (authenticatedUser: User) => {
    if (onUserChange) {
      onUserChange(authenticatedUser);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`http://localhost:3000/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (onUserChange) {
        onUserChange(null);
      }
    } catch (err) {
      console.error("Error logging out", err);
    }
  };

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

        {/* Action Buttons Section */}
        <div className="p-4 border-b border-gray-700">
          {collapsed ? (
            // Collapsed state - show icon buttons with tooltips
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
            // Expanded state - show full buttons
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
        <div className="flex-1 overflow-y-auto p-4">
          {!collapsed && (
            <>
              <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                Recent Chats
              </h3>
              <div className="space-y-3">
                {/* Sample chat items with bubble design */}
                <div className="p-4 rounded-2xl bg-gray-800/30 hover:bg-gray-700/40 transition-all duration-200 cursor-pointer border border-gray-600/20 hover:border-gray-500/30">
                  <div className="flex items-start space-x-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white mb-1 truncate">Getting Started with AI</p>
                      <p className="text-xs text-gray-400 mb-2 line-clamp-2">How does artificial intelligence work?</p>
                      <p className="text-xs text-gray-500">30m ago</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-2xl bg-gray-800/30 hover:bg-gray-700/40 transition-all duration-200 cursor-pointer border border-gray-600/20 hover:border-gray-500/30">
                  <div className="flex items-start space-x-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white mb-1 truncate">Project Planning</p>
                      <p className="text-xs text-gray-400 mb-2 line-clamp-2">Can you help me plan my next project?</p>
                      <p className="text-xs text-gray-500">2h ago</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-2xl bg-gray-800/30 hover:bg-gray-700/40 transition-all duration-200 cursor-pointer border border-gray-600/20 hover:border-gray-500/30">
                  <div className="flex items-start space-x-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white mb-1 truncate">Code Review</p>
                      <p className="text-xs text-gray-400 mb-2 line-clamp-2">Please review this React component</p>
                      <p className="text-xs text-gray-500">1d ago</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-2xl bg-gray-800/30 hover:bg-gray-700/40 transition-all duration-200 cursor-pointer border border-gray-600/20 hover:border-gray-500/30">
                  <div className="flex items-start space-x-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white mb-1 truncate">Design Feedback</p>
                      <p className="text-xs text-gray-400 mb-2 line-clamp-2">What do you think about this UI?</p>
                      <p className="text-xs text-gray-500">2d ago</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Settings */}
        <div className="p-4 border-t border-gray-700/50">
          {collapsed ? (
            <div className="flex justify-center">
              <TooltipButton
                icon={<Settings className="w-5 h-5 text-gray-400" />}
                tooltip="Settings"
                onClick={() => console.log('Settings clicked')}
                className="hover:bg-gray-700/30"
              />
            </div>
          ) : (
            <button
              onClick={() => console.log('Settings clicked')}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-700/30 transition-all duration-200 text-gray-400 hover:text-white"
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">Settings</span>
            </button>
          )}
        </div>

        {/* User Section */}
        <div className="p-4 border-t border-gray-700/50">
          {user && user.id !== 'guest' ? (
            collapsed ? (
              // Collapsed user section
              <div className="flex flex-col items-center space-y-3">
                <TooltipButton
                  icon={
                    user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name || 'User'} className="w-8 h-8 rounded-full" />
                    ) : (
                      <User className="w-5 h-5 text-white" />
                    )
                  }
                  tooltip={user.name || user.email || 'User Profile'}
                  onClick={() => console.log('User profile clicked')}
                />
                <TooltipButton
                  icon={<LogOut className="w-5 h-5 text-red-400" />}
                  tooltip="Sign Out"
                  onClick={handleLogout}
                  className="hover:bg-red-500/10"
                />
              </div>
            ) : (
              // Expanded user section
              <div className="space-y-3">
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-gray-800/30 border border-gray-600/20">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name || 'User'} className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center">
                      <User className="w-5 h-5 text-black" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {user.name || 'User'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {user.email || `Signed in with ${user.provider}`}
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
            // Not logged in state - show login button
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
            //TODO:fix the google avatar 
        isOpen={showLoginModal} 
        onClose={() => setShowLoginModal(false)} 
        onLoginSuccess={handleLoginSuccess}
      />
    </>
  );
};

export default Sidebar;