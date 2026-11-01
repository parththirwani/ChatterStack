"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  memo,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';

import { useAppStore } from '@/src/store/rootStore';
import { appViewFromPath, isAppPagePath, navigateTo, scheduledPath, showConversation, skillsPath } from '@/src/lib/navigation';
import type { SidebarPage } from '@/src/components/sidebar/actions/SidebarActionButton';
import AppPages from '@/src/components/pages/AppPages';
import SkillEditorHost from '@/src/components/customize/SkillEditorHost';
import type { User } from '@/src/types/user.types';
import type { Conversation } from '@/src/types/conversation.types';
import ChatInterface from '@/src/components/chat/interface/ChatInterface';
import Sidebar from '@/src/components/sidebar/Sidebar';
import LoginModal from '@/src/components/auth/AuthModal';
import Toaster from '@/src/components/ui/toast/Toaster';
import { toast } from '@/src/lib/client/toast';

export interface ChatPageProps {
  initialUser: User | null;
  initialConversations: Conversation[];
  initialConversation: Conversation | null;
  conversationId?: string;
  conversationMissing: boolean;
}

function conversationIdFromPathname(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean);
  if (isAppPagePath(segments)) return undefined;
  return segments[0] || undefined;
}

const ChatPage: React.FC<ChatPageProps> = ({
  initialUser,
  initialConversations,
  initialConversation,
  conversationId: serverConversationId,
  conversationMissing,
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const storeUser = useAppStore((state) => state.user);
  const userHydrated = useAppStore((state) => state.userHydrated);
  // Before the first effect runs, render the server-provided user so the
  // sidebar and header are correct in the initial HTML.
  const user = userHydrated ? storeUser : initialUser;

  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const storeCurrentId = useAppStore((state) => state.currentConversationId);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const initializeUser = useAppStore((state) => state.initializeUser);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const logout = useAppStore((state) => state.logout);

  const urlConversationId = conversationIdFromPathname(pathname);
  const view = useMemo(() => appViewFromPath(pathname), [pathname]);
  // The store's id is the single source of truth once it has been synced
  // from the URL; until then (the server render and hydration) use the URL.
  const [urlSynced, setUrlSynced] = useState(false);
  const activeConversationId = urlSynced ? storeCurrentId : urlConversationId;
  const fetchConversation = useAppStore((state) => state.fetchConversation);
  const missingOnClient = useAppStore((state) =>
    activeConversationId ? state.missingConversationIds[activeConversationId] === true : false
  );
  const activeConversationMissing =
    missingOnClient || (conversationMissing && activeConversationId === serverConversationId);

  // Freeze the first server payload. Later RSC payloads are handled by
  // hydrateConversation and the client store; re-seeding the whole list on
  // every navigation would clobber optimistic updates.
  const firstServerPayload = useRef({ user: initialUser, conversations: initialConversations }).current;

  // Mobile sidebar state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuWasOpenRef = useRef(false);

  // Modal states - AT ROOT LEVEL
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Seed the client store once from the server render. This removes the
  // "Loading…" spinner + follow-up /api/auth/session request that used to run
  // on every page load.
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      // Rehydrate the persisted UI preference after hydration instead of
      // during render (which previously caused hydration mismatches).
      try {
        await useAppStore.persist.rehydrate();
      } catch {
        // storage unavailable
      }
      if (cancelled) return;

      try {
        const urlParams = new URLSearchParams(window.location.search);
        const authSuccess = urlParams.get('auth') === 'success';
        const errorCode = urlParams.get('error');
        if (authSuccess || errorCode) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        if (errorCode) {
          setAuthError(errorCode);
          setShowLoginModal(true);
        }
      } catch {
        // non-browser environment - ignore
      }

      useAppStore.getState().hydrateSession(firstServerPayload);
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [firstServerPayload]);

  // Seed each conversation the server hands us. The store wins if it already
  // has messages, so an in-flight or already-visited chat is never replaced.
  useEffect(() => {
    if (initialConversation) {
      useAppStore.getState().hydrateConversation(initialConversation);
    }
  }, [initialConversation]);

  // The URL follows the store: switching chats only rewrites the URL with
  // history.pushState (see `showConversation`), which Next.js mirrors into
  // usePathname without a server round-trip or remounting this page. This
  // effect covers the other direction (first load, back/forward), and runs
  // before paint so the previous chat never shows for a frame.
  // App pages (Customize, Resources) leave the open chat as it is, so it's
  // still there, streaming or not, when the user comes back to it.
  const onAppPage = view.kind !== 'chat';
  useLayoutEffect(() => {
    const state = useAppStore.getState();
    if (!onAppPage && state.currentConversationId !== urlConversationId) {
      state.setCurrentConversationId(urlConversationId);
    }
    setUrlSynced(true);
  }, [urlConversationId, onAppPage]);

  // A chat that isn't in memory yet (not server-rendered, not visited, not
  // prefetched on hover) loads from the API; a skeleton shows meanwhile.
  useEffect(() => {
    if (activeConversationId && activeConversationId !== serverConversationId) {
      void fetchConversation(activeConversationId);
    }
  }, [activeConversationId, serverConversationId, fetchConversation]);

  // Close mobile menu when conversation changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeConversationId]);

  // Stable (reads the current value from the store) so toggling doesn't hand
  // the sidebar a new prop and re-render it.
  const handleToggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setMobileMenuOpen((open) => !open);
      return;
    }
    const wasCollapsed = useAppStore.getState().sidebarCollapsed;
    setSidebarCollapsed(!wasCollapsed);
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(
          wasCollapsed ? '[aria-label="Close sidebar"]' : '[aria-label="Open sidebar"]'
        )
        ?.focus();
    }, 0);
  }, [setSidebarCollapsed]);

  useEffect(() => {
    window.addEventListener('chatterstack:toggle-sidebar', handleToggleSidebar);
    return () => window.removeEventListener('chatterstack:toggle-sidebar', handleToggleSidebar);
  }, [handleToggleSidebar]);

  useLayoutEffect(() => {
    if (mobileMenuOpen) {
      menuWasOpenRef.current = true;
      window.setTimeout(() => document.querySelector<HTMLElement>('#chat-sidebar button')?.focus(), 30);
    } else if (menuWasOpenRef.current) {
      menuWasOpenRef.current = false;
      window.setTimeout(() => document.getElementById('chat-sidebar-toggle')?.focus(), 30);
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
      if (event.key === 'Tab') {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            '#chat-sidebar a, #chat-sidebar button, #chat-sidebar input'
          )
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  const handleConversationSelect = useCallback((conversationId: string) => {
    const state = useAppStore.getState();
    state.setCurrentConversationId(conversationId);
    // No-op if loaded; retries a load that failed.
    void state.fetchConversation(conversationId);
    setMobileMenuOpen(false);
    showConversation(conversationId);
  }, []);

  const handleNewChat = useCallback(() => {
    const state = useAppStore.getState();
    const draft = state.chatState.new;
    if (!draft?.loading) state.clearChatState('new');
    state.setCurrentConversationId(undefined);
    setMobileMenuOpen(false);
    showConversation(undefined);
  }, []);

  const handleOpenPage = useCallback((page: SidebarPage) => {
    setMobileMenuOpen(false);
    navigateTo(page === 'resources' ? '/resources' : page === 'scheduled' ? scheduledPath.list : skillsPath.discover);
  }, []);

  useEffect(() => {
    window.addEventListener('chatterstack:new-chat', handleNewChat);
    return () => window.removeEventListener('chatterstack:new-chat', handleNewChat);
  }, [handleNewChat]);

  const handleLoginClick = useCallback(() => {
    setAuthError(null);
    setShowLoginModal(true);
  }, []);

  const handleLoginSuccess = useCallback(async () => {
    setShowLoginModal(false);
    setAuthError(null);

    // The OAuth flow usually does a full-page redirect (so SSR covers it).
    // This path handles a modal session that resolved client-side.
    await initializeUser();
    void loadConversations(true);
  }, [initializeUser, loadConversations]);

  // Sign out from the sidebar menu happens at once, without a confirmation step; the menu shows its progress.
  const handleLogoutClick = useCallback(async () => {
    try {
      await logout();
    } catch {
      // The session is still there, so stay on the page and say so.
      toast.error("Couldn't sign out. Check your connection and try again.");
      return;
    }
    startTransition(() => {
      router.push('/');
      router.refresh();
    });
  }, [logout, router]);

  const handleLoginModalClose = useCallback(() => {
    setShowLoginModal(false);
    setAuthError(null);
  }, []);

  const sidebarProps = useMemo(
    () => ({
      collapsed: false,
      onToggleCollapse: handleToggleSidebar,
      user,
      onConversationSelect: handleConversationSelect,
      onNewChat: handleNewChat,
      // Like claude.ai, no chat is highlighted while a page is open.
      currentConversationId: onAppPage ? undefined : activeConversationId,
      // Connections sit under the same Customize entry as skills.
      activePage: view.kind === 'chat' ? undefined : view.kind === 'connections' ? 'skills' : view.kind,
      onOpenPage: handleOpenPage,
      onLoginClick: handleLoginClick,
      onLogoutClick: handleLogoutClick,
      initialConversations: firstServerPayload.conversations,
    }),
    [
      handleToggleSidebar,
      user,
      handleConversationSelect,
      handleNewChat,
      activeConversationId,
      onAppPage,
      handleLoginClick,
      handleLogoutClick,
      firstServerPayload,
      view.kind,
      handleOpenPage,
    ]
  );

  return (
    <>
      <div className="relative flex h-dvh overflow-hidden">
        <a
          href="#chat-main"
          tabIndex={mobileMenuOpen ? -1 : 0}
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-[#2c2c2c] focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to chat
        </a>

        {/* Backdrop */}
        {mobileMenuOpen && (
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          id="chat-sidebar"
          aria-label="Chat navigation"
          inert={sidebarCollapsed && !mobileMenuOpen}
          className={`
            fixed inset-y-0 left-0 z-40 w-72 transition-[transform,width] duration-200 ease-out lg:relative lg:z-auto lg:overflow-hidden lg:translate-x-0
            ${sidebarCollapsed ? 'lg:w-0' : 'lg:w-72'}
            ${mobileMenuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible'}
          `}
        >
          <button
            ref={(node) => {
              if (node && mobileMenuOpen) node.focus();
            }}
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
          <MemoizedSidebar {...sidebarProps} />
        </aside>

        {/* Main Chat Area */}
        <main id="chat-main" inert={mobileMenuOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {view.kind !== 'chat' && <AppPages key={view.kind} view={view} user={user} />}
          {/* Kept mounted while a page is open, so the composer and any
              streaming answer carry on when the user comes back. */}
          <div hidden={view.kind !== 'chat'} className="flex min-h-0 flex-1 flex-col">
          <MemoizedChatInterface
            selectedConversationId={activeConversationId}
            initialConversation={initialConversation}
            conversationMissing={activeConversationMissing}
            mobileMenuOpen={mobileMenuOpen}
            sidebarCollapsed={sidebarCollapsed}
          />
          </div>
        </main>
      </div>

      {user && user.id !== 'guest' && <SkillEditorHost />}

      {/* Login Modal - AT ROOT LEVEL, OUTSIDE MAIN LAYOUT */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={handleLoginModalClose}
        onLoginSuccess={handleLoginSuccess}
        message="Sign in to save your conversations"
        initialError={authError}
      />

      <Toaster />
    </>
  );
};

const MemoizedChatInterface = memo(ChatInterface);
const MemoizedSidebar = memo(Sidebar);

MemoizedChatInterface.displayName = 'MemoizedChatInterface';
MemoizedSidebar.displayName = 'MemoizedSidebar';

export default ChatPage;
