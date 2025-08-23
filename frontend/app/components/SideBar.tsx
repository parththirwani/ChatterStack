import React, { useState } from 'react';
import { MessageCircle, Plus, ChevronLeft, Search, Settings, LogIn, User, LogOut } from 'lucide-react';
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

const Sidebar: React.FC<SidebarProps> = ({ 
  collapsed, 
  onToggleCollapse, 
  user = null, 
  onUserChange 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);

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
      <div className={`border-r border-gray-700 transition-all duration-300 ${collapsed ? 'w-16' : 'w-80'} flex flex-col`} style={{ backgroundColor: '#141017' }}>
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            {!collapsed && (
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-black" />
                </div>
                <h2 className="font-semibold text-white">ChatterStack</h2>
              </div>
            )}
            <button
              onClick={onToggleCollapse}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {!collapsed && (
            <>
              <button className="w-full mt-4 bg-yellow-500 text-black py-2.5 px-4 rounded-xl flex items-center justify-center space-x-2 hover:bg-yellow-400 transition-colors font-medium">
                <Plus className="w-4 h-4" />
                <span>New Chat</span>
              </button>
              
              <div className="relative mt-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#211d22] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-400 border border-gray-600"
                />
              </div>
            </>
          )}
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-2">
          {!collapsed && (
            <div className="space-y-2">
              <div className="px-3 py-2">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">RECENT CHATS</p>
              </div>
              {/* Chat history will be populated from actual data */}
              <div className="px-3 py-8 text-center">
                <p className="text-sm text-gray-400">No chats yet</p>
                <p className="text-xs text-gray-500 mt-1">Start a new conversation to see your chat history</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 space-y-2">
          {!collapsed && (
            <button className="w-full p-3 rounded-lg bg-[#211d22] hover:bg-gray-600 transition-colors flex items-center space-x-3 text-gray-300">
              <Settings className="w-4 h-4" />
              <span className="text-sm">Settings</span>
            </button>
          )}
          
          {user && user.id !== 'guest' ? (
            // User is logged in - show user info and logout option
            <div className="space-y-2">
              {!collapsed ? (
                // Full user info when sidebar is expanded
                <div className="p-3 rounded-lg bg-[#211d22] border border-gray-600">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-600 flex-shrink-0">
                      {user.avatarUrl ? (
                        <img 
                          src={user.avatarUrl} 
                          alt="User Avatar" 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-yellow-500 flex items-center justify-center">
                          <User className="w-4 h-4 text-black" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {user.name || 'User'}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {user.email || `Signed in with ${user.provider}`}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                // Just avatar when collapsed
                <div className="flex justify-center">
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-600">
                    {user.avatarUrl ? (
                      <img 
                        src={user.avatarUrl} 
                        alt="User Avatar" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-yellow-500 flex items-center justify-center">
                        <User className="w-5 h-5 text-black" />
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              <button 
                onClick={handleLogout}
                className="w-full p-3 rounded-lg bg-red-600 hover:bg-red-700 transition-colors flex items-center justify-center space-x-3 text-white font-medium"
              >
                <LogOut className="w-4 h-4" />
                {!collapsed && <span>Logout</span>}
              </button>
            </div>
          ) : (
            // User is not logged in - show login button
            <button 
              onClick={handleLoginClick}
              className="w-full p-3 rounded-lg bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center justify-center space-x-3 text-black font-medium"
            >
              <LogIn className="w-4 h-4" />
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