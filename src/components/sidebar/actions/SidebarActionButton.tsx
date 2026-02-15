
import React from 'react';
import { Plus, Search } from 'lucide-react';
import TooltipButton from './Tooltip';

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
    <div className="p-4 border-b border-gray-700">
      {collapsed ? (
        <div className="space-y-3 flex flex-col items-center">
          <TooltipButton
            icon={<Plus className="w-5 h-5 text-black" />}
            tooltip="New Chat"
            onClick={onNewChat}
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
            onClick={onNewChat}
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
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full bg-gray-800/50 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder-gray-400 border border-gray-600/30 hover:border-gray-500/50 focus:border-yellow-500/50 focus:outline-none transition-colors"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SidebarActionButtons;