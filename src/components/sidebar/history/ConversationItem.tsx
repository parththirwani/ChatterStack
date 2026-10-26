import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Pencil, PencilLine, Pin, PinOff, Trash2 } from 'lucide-react';
import { useAppStore } from '@/src/store/rootStore';
import { Conversation } from '@/src/types/conversation.types';
import { Orb } from '@/src/components/ui/orb/Orb';
import DeleteConversationModal from './DeleteModal';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  isStreaming: boolean;
  onClick: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** Warm the chat's messages so opening it is instant. */
  onPrefetch?: (id: string) => void;
}

const MENU_WIDTH = 176;
const TITLE_MAX_LENGTH = 80;

// Opening a chat changes the URL, which remounts the sidebar. Double-clicking
// a chat that isn't open does exactly that (the first click opens it), so an
// in-progress rename is kept here to survive the remount.
let pendingRename: { id: string; draft: string; startedAt: number } | null = null;
const RENAME_RESUME_MS = 3000;

function resumableRename(id: string) {
  return pendingRename?.id === id && Date.now() - pendingRename.startedAt < RENAME_RESUME_MS ? pendingRename : null;
}

function fallbackTitle(conversation: Conversation): string {
  const first = conversation.messages?.find((message) => message.role === 'user')?.content.trim();
  return first ? first.slice(0, TITLE_MAX_LENGTH) : 'New chat';
}

/** "✎ Draft  unsent text…" line under a chat title. */
export const DraftPreview: React.FC<{ text: string }> = ({ text }) => (
  <>
    <span aria-hidden="true" className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] leading-4">
      <PencilLine className="h-3 w-3 shrink-0 text-[#d9b77e]" strokeWidth={1.8} />
      <span className="shrink-0 font-medium text-[#d9b77e]">Draft</span>
      <span className="min-w-0 truncate text-[#8f8b86]">{text.replace(/\s+/g, ' ').trim()}</span>
    </span>
    <span className="sr-only">, unsent draft</span>
  </>
);

interface MenuProps {
  anchor: HTMLElement;
  pinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: (returnFocus: boolean) => void;
}

/**
 * Rendered in a portal with fixed positioning: the chat list scrolls, so an
 * absolutely positioned menu would be clipped by it near the bottom.
 */
const ConversationMenu: React.FC<MenuProps> = ({ anchor, pinned, onPin, onRename, onDelete, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - height) : below;
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setPosition({ top, left });
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchor.contains(target)) onClose(false);
    };
    // The list scrolls under a fixed menu, so close rather than drift.
    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [anchor, onClose]);

  const item = 'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors focus-visible:outline-none';

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Chat actions"
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: MENU_WIDTH }}
      className="animate-menu-in fixed z-[60] rounded-[12px] border border-white/[0.11] bg-[#242424] p-1 shadow-[0_18px_44px_rgba(0,0,0,0.42)]"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          onClose(true);
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }}
    >
      <button type="button" role="menuitem" tabIndex={-1} onClick={onPin} className={`${item} text-[#e6e3de] hover:bg-white/[0.06] focus-visible:bg-white/[0.06]`}>
        {pinned ? <PinOff className="h-4 w-4 text-[#a9a5a0]" strokeWidth={1.7} aria-hidden="true" /> : <Pin className="h-4 w-4 text-[#a9a5a0]" strokeWidth={1.7} aria-hidden="true" />}
        {pinned ? 'Unpin' : 'Pin'}
      </button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={onRename} className={`${item} text-[#e6e3de] hover:bg-white/[0.06] focus-visible:bg-white/[0.06]`}>
        <Pencil className="h-4 w-4 text-[#a9a5a0]" strokeWidth={1.7} aria-hidden="true" />
        Rename
      </button>
      <div className="mx-1.5 my-1 h-px bg-white/[0.08]" role="separator" />
      <button type="button" role="menuitem" tabIndex={-1} onClick={onDelete} className={`${item} text-red-300 hover:bg-red-500/10 focus-visible:bg-red-500/10`}>
        <Trash2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        Delete
      </button>
    </div>,
    document.body
  );
};

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  isStreaming,
  onClick,
  onDelete,
  onRename,
  onTogglePin,
  onPrefetch,
}) => {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuOpen = menuAnchor !== null;
  const [editing, setEditing] = useState(() => resumableRename(conversation.id) !== null);
  const [draft, setDraft] = useState(() => resumableRename(conversation.id)?.draft ?? '');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayTitle = conversation.title || fallbackTitle(conversation);
  // Only this row re-renders when its draft changes, and the open chat's
  // draft isn't shown (you're looking at it in the composer).
  const unsentDraft = useAppStore((state) => (isActive ? undefined : state.drafts[conversation.id]));
  const pinned = Boolean(conversation.pinnedAt);

  const startEditing = useCallback(() => {
    setMenuAnchor(null);
    setDraft(displayTitle);
    setEditing(true);
    pendingRename = { id: conversation.id, draft: displayTitle, startedAt: Date.now() };
  }, [displayTitle, conversation.id]);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const finishEditing = useCallback(
    (save: boolean) => {
      if (!editing) return;
      setEditing(false);
      pendingRename = null;
      const title = draft.trim().slice(0, TITLE_MAX_LENGTH);
      if (save && title && title !== displayTitle) onRename(conversation.id, title);
      requestAnimationFrame(() => titleButtonRef.current?.focus());
    },
    [editing, draft, displayTitle, onRename, conversation.id]
  );

  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenuAnchor(null);
    if (returnFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(conversation.id);
      setShowDeleteModal(false);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete conversation. Please try again.'
      );
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, conversation.id]);

  const handleCloseModal = useCallback(() => {
    if (!isDeleting) {
      setShowDeleteModal(false);
      setDeleteError(null);
    }
  }, [isDeleting]);

  return (
    <>
      <div
        className={`group relative flex items-center rounded-lg transition-colors duration-150 ${
          isActive || menuOpen ? 'bg-white/[0.07]' : 'hover:bg-white/[0.045]'
        }`}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={TITLE_MAX_LENGTH}
            aria-label="Chat title"
            onChange={(event) => {
              setDraft(event.target.value);
              if (pendingRename?.id === conversation.id) pendingRename.draft = event.target.value;
            }}
            onBlur={() => finishEditing(true)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                finishEditing(true);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                finishEditing(false);
              }
            }}
            className="mx-1 my-0.5 h-8 min-w-0 flex-1 rounded-md border border-white/[0.18] bg-[#1d1d1d] px-2 text-[13px] text-white outline-none focus:border-white/[0.38]"
          />
        ) : (
          <button
            ref={titleButtonRef}
            type="button"
            onClick={() => onClick(conversation.id)}
            onPointerEnter={onPrefetch && (() => onPrefetch(conversation.id))}
            onFocus={onPrefetch && (() => onPrefetch(conversation.id))}
            onDoubleClick={startEditing}
            aria-current={isActive ? 'page' : undefined}
            className="min-w-0 flex-1 rounded-lg px-3 py-2 pr-10 text-left text-[13px] leading-5 transition-colors focus-visible:outline-none"
          >
            <span className={`block truncate ${isActive ? 'text-white' : 'text-[#c4c0bb] group-hover:text-white'}`}>
              {displayTitle}
            </span>
            {unsentDraft && <DraftPreview text={unsentDraft} />}
            {isStreaming && <span className="sr-only">, generating</span>}
          </button>
        )}

        {!editing && (
          <div className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center">
            {isStreaming && !menuOpen && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity sm:group-hover:opacity-0 sm:group-focus-within:opacity-0">
                <Orb />
              </span>
            )}
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={`Actions for ${displayTitle}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(event) => {
                event.stopPropagation();
                setMenuAnchor(menuOpen ? null : event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMenuAnchor(event.currentTarget);
                }
              }}
              className={`relative flex h-8 w-8 items-center justify-center rounded-md text-[#a9a5a0] transition-[opacity,color,background-color] hover:bg-white/[0.08] hover:text-white focus-visible:opacity-100 ${
                menuOpen
                  ? 'opacity-100'
                  : isStreaming
                    ? 'opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'
                    : `${isActive ? 'opacity-100' : 'opacity-100 sm:opacity-0'} sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`
              }`}
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {menuAnchor && (
        <ConversationMenu
          anchor={menuAnchor}
          pinned={pinned}
          onPin={() => {
            closeMenu(true);
            onTogglePin(conversation.id, !pinned);
          }}
          onRename={startEditing}
          onDelete={() => {
            closeMenu(false);
            setDeleteError(null);
            setShowDeleteModal(true);
          }}
          onClose={closeMenu}
        />
      )}

      {showDeleteModal && typeof document !== 'undefined' && createPortal(
        <DeleteConversationModal
          isOpen={showDeleteModal}
          onClose={handleCloseModal}
          onConfirm={handleConfirmDelete}
          conversationTitle={displayTitle}
          isDeleting={isDeleting}
          error={deleteError}
        />,
        document.body
      )}
    </>
  );
};

export default memo(ConversationItem, (prev, next) => {
  return (
    prev.conversation.id === next.conversation.id &&
    prev.conversation.title === next.conversation.title &&
    prev.conversation.pinnedAt === next.conversation.pinnedAt &&
    prev.conversation.updatedAt === next.conversation.updatedAt &&
    prev.isActive === next.isActive &&
    prev.isStreaming === next.isStreaming &&
    prev.onClick === next.onClick &&
    prev.onDelete === next.onDelete &&
    prev.onRename === next.onRename &&
    prev.onTogglePin === next.onTogglePin &&
    prev.onPrefetch === next.onPrefetch
  );
});
