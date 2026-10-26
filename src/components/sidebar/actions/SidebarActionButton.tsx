import React, { useEffect, useRef, memo } from 'react';
import { Plus, Search, SquarePen, X } from 'lucide-react';

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
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated || collapsed) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAuthenticated, collapsed]);

  return (
    <div className="space-y-2">
      {collapsed ? (
        <div className="flex flex-col items-center space-y-2">
          {/* New Chat - smaller and minimalistic */}
          <button
            onClick={onNewChat}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#c9c5c0] transition-colors hover:bg-white/[0.07]"
            title="New Chat"
            aria-label="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {/* Search - smaller and minimalistic */}
          {isAuthenticated && (
            <button
              onClick={() => {}}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.05] text-[#8f8b86] transition-colors hover:bg-white/[0.09] hover:text-[#d8d4ce]"
              title="Search Chats"
              aria-label="Search chats"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            onClick={onNewChat}
            className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-[#e5e2de] transition-colors hover:bg-white/[0.06]"
          >
            <SquarePen className="h-4 w-4 text-[#b3afa9]" strokeWidth={1.8} />
            <span className="text-sm">New chat</span>
          </button>

          {isAuthenticated && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8f8b86]" />
              <input
                ref={searchInputRef}
                type="text"
                aria-label="Search conversations"
                placeholder="Search chats"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    if (searchQuery) onSearchChange('');
                    else searchInputRef.current?.blur();
                  }
                }}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.025] py-2 pl-9 pr-9 text-[13px] text-white placeholder-[#8a8681] transition-colors hover:border-white/[0.14] focus:border-white/[0.38] focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-white/[0.10]"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    onSearchChange('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[#8f8b86] transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default memo(SidebarActionButtons);
