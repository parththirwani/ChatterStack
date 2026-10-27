import React, { useEffect, useRef, useState, memo } from 'react';
import { CalendarClock, Files, Search, SlidersHorizontal, SquarePen, X } from 'lucide-react';

export type SidebarPage = 'resources' | 'scheduled' | 'skills';

interface SidebarActionButtonsProps {
  collapsed: boolean;
  isAuthenticated: boolean;
  searchQuery: string;
  onNewChat: () => void;
  onSearchChange: (query: string) => void;
  /** The page open in the main area, if any. */
  activePage?: SidebarPage;
  onOpenPage?: (page: SidebarPage) => void;
}

const rowClass = (active: boolean) =>
  `flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${
    active ? 'bg-white/[0.09] text-white' : 'text-[#e5e2de] hover:bg-white/[0.06]'
  }`;
const iconRowClass = (active: boolean) =>
  `flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
    active ? 'bg-white/[0.09] text-white' : 'text-[#c9c5c0] hover:bg-white/[0.07]'
  }`;

/** The sidebar's navigation rows, one per line like claude.ai. */
const SidebarActionButtons: React.FC<SidebarActionButtonsProps> = ({
  collapsed,
  isAuthenticated,
  searchQuery,
  onNewChat,
  onSearchChange,
  activePage,
  onOpenPage,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  // The Search row turns into the search field while it's in use.
  const [searching, setSearching] = useState(false);
  const showSearchField = searching || !!searchQuery;

  useEffect(() => {
    if (!isAuthenticated || collapsed) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAuthenticated, collapsed]);

  const openSearch = () => {
    setSearching(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  if (collapsed) {
    return (
      <nav aria-label="Main" className="flex flex-col items-center space-y-1">
        <button type="button" onClick={onNewChat} className={iconRowClass(false)} title="New chat" aria-label="New chat">
          <SquarePen className="h-4 w-4" strokeWidth={1.8} />
        </button>
        {isAuthenticated && <>
          <button type="button" onClick={openSearch} className={iconRowClass(false)} title="Search chats" aria-label="Search chats">
            <Search className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => onOpenPage?.('resources')} className={iconRowClass(activePage === 'resources')} title="Resources" aria-label="Resources" aria-current={activePage === 'resources' ? 'page' : undefined}>
            <Files className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => onOpenPage?.('scheduled')} className={iconRowClass(activePage === 'scheduled')} title="Scheduled" aria-label="Scheduled" aria-current={activePage === 'scheduled' ? 'page' : undefined}>
            <CalendarClock className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => onOpenPage?.('skills')} className={iconRowClass(activePage === 'skills')} title="Customize" aria-label="Customize" aria-current={activePage === 'skills' ? 'page' : undefined}>
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </>}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="space-y-0.5">
      <button type="button" onClick={onNewChat} className={rowClass(false)}>
        <SquarePen className="h-4 w-4 text-[#b3afa9]" strokeWidth={1.8} />
        <span>New chat</span>
      </button>

      {isAuthenticated && (showSearchField ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8f8b86]" />
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Search conversations"
            placeholder="Search chats"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={() => { if (!searchQuery) setSearching(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (searchQuery) onSearchChange('');
                else searchInputRef.current?.blur();
              }
            }}
            className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.025] pl-9 pr-9 text-[13px] text-white placeholder-[#8a8681] transition-colors hover:border-white/[0.14] focus:border-white/[0.38] focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-white/[0.10]"
          />
          {searchQuery && (
            <button
              type="button"
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
      ) : (
        <button type="button" onClick={openSearch} className={rowClass(false)} aria-keyshortcuts="Control+K">
          <Search className="h-4 w-4 text-[#b3afa9]" strokeWidth={1.8} />
          <span className="flex-1">Search</span>
          <kbd className="text-[11px] text-[#77736f]">Ctrl K</kbd>
        </button>
      ))}

      {isAuthenticated && <>
        <button type="button" onClick={() => onOpenPage?.('resources')} className={rowClass(activePage === 'resources')} aria-current={activePage === 'resources' ? 'page' : undefined}>
          <Files className="h-4 w-4 text-[#b3afa9]" strokeWidth={1.8} />
          <span>Resources</span>
        </button>
        <button type="button" onClick={() => onOpenPage?.('scheduled')} className={rowClass(activePage === 'scheduled')} aria-current={activePage === 'scheduled' ? 'page' : undefined}>
          <CalendarClock className="h-4 w-4 text-[#b3afa9]" strokeWidth={1.8} />
          <span>Scheduled</span>
        </button>
        <button type="button" onClick={() => onOpenPage?.('skills')} className={rowClass(activePage === 'skills')} aria-current={activePage === 'skills' ? 'page' : undefined}>
          <SlidersHorizontal className="h-4 w-4 text-[#b3afa9]" strokeWidth={1.8} />
          <span>Customize</span>
        </button>
      </>}
    </nav>
  );
};

export default memo(SidebarActionButtons);
