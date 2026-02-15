import React from 'react';
import { Plus, Search } from 'lucide-react';

interface SidebarActionButtonsProps {
  collapsed: boolean;
  isAuthenticated: boolean;
  searchQuery: string;
  onNewChat: () => void;
  onSearchChange: (query: string) => void;
}

const SidebarActionButtons: React.FC<SidebarActionButtonsProps> = ({
  collapsed,
  isAuthenticated,
  searchQuery,
  onNewChat,
  onSearchChange,
}) => {
  return (
    <div className="space-y-2">
      {collapsed ? (
        <div className="flex flex-col items-center space-y-2">
          {/* New Chat - smaller and minimalistic */}
          <button
            onClick={onNewChat}
            className="w-7 h-7 rounded-md bg-gradient-to-br from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-yellow-700 text-black flex items-center justify-center transition-all active:scale-95"
            title="New Chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          
          {/* Search - smaller and minimalistic */}
          {isAuthenticated && (
            <button
              onClick={() => {}}
              className="w-7 h-7 rounded-md bg-gray-800/50 hover:bg-gray-700/50 text-gray-400 hover:text-gray-300 flex items-center justify-center transition-colors"
              title="Search Chats"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            onClick={onNewChat}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-yellow-700 text-black font-medium shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm">New Chat</span>
          </button>
          
          {isAuthenticated && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full bg-gray-900/50 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 border border-gray-800/50 hover:border-gray-700/50 focus:border-yellow-500/50 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 transition-colors"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SidebarActionButtons;