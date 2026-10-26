import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { createUserSlice, UserSlice } from './slices/user/userSlice';
import { createChatSlice, ChatSlice } from './slices/chat/chatSlice';
import { createUISlice, UISlice } from './slices/ui/uiSlice';
import { createDraftSlice, DraftSlice } from './slices/drafts/draftSlice';
import { ConversationsSlice, createConversationsSlice, sortConversations } from './slices/conversations/conversationSlice';
import type { User } from '@/src/types/user.types';
import type { Conversation } from '@/src/types/conversation.types';

export interface HydrateSessionPayload {
  user: User | null;
  conversations: Conversation[];
}

// Export the full AppState type
export type AppState = UserSlice &
  ChatSlice &
  ConversationsSlice &
  UISlice &
  DraftSlice & {
    /** Seed the store with server-rendered session data before any client fetch. */
    hydrateSession: (payload: HydrateSessionPayload) => void;
    reset: () => void;
  };

type PersistedState = Pick<AppState, 'sidebarCollapsed' | 'drafts' | 'draftsOwner'>;

let lastPersisted: PersistedState | null = null;

/**
 * localStorage for the few persisted fields. zustand's persist calls setItem
 * on every store update (each 40ms stream flush included), so this writes only
 * when a persisted field actually changed (all are replaced, not mutated,
 * when they change). Writes are also ignored until the saved state has been
 * read back after mount; otherwise an update made before then would overwrite
 * saved drafts and settings with the empty defaults.
 */
const persistedStorage: PersistStorage<PersistedState> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (!useAppStore.persist.hasHydrated()) return;
    const next = value.state;
    if (
      lastPersisted &&
      lastPersisted.drafts === next.drafts &&
      lastPersisted.draftsOwner === next.draftsOwner &&
      lastPersisted.sidebarCollapsed === next.sidebarCollapsed
    ) {
      return;
    }
    lastPersisted = next;
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch {
      // Storage full or unavailable: drafts just won't survive a reload.
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ...createUserSlice(set, get, store),
      ...createChatSlice(set, get, store),
      ...createConversationsSlice(set, get, store),
      ...createUISlice(set, get, store),
      ...createDraftSlice(set, get, store),

      // ChatPage can remount on navigation (e.g. /<id> -> /) and re-send its
      // first server payload. For the same signed-in user the client list is
      // newer (chats created, renamed or pinned since), so only add
      // conversations it doesn't know about instead of replacing it.
      hydrateSession: ({ user, conversations }) =>
        set((state) => {
          // Drafts saved by a different account on this browser are dropped.
          const draftsReset =
            state.draftsOwner && state.draftsOwner !== user?.id ? { drafts: {}, draftsOwner: null } : {};
          const sameUser = state.conversationsHydrated && state.user?.id === user?.id;
          if (!sameUser) {
            return { ...draftsReset, user, userLoading: false, userHydrated: true, conversations, conversationsHydrated: true };
          }
          const known = new Set(state.conversations.map((conversation) => conversation.id));
          const added = conversations.filter((conversation) => !known.has(conversation.id));
          return {
            ...draftsReset,
            user,
            userLoading: false,
            userHydrated: true,
            conversationsHydrated: true,
            conversations: added.length ? sortConversations([...state.conversations, ...added]) : state.conversations,
          };
        }),

      reset: () => {
        set({
          user: null,
          userLoading: false,
          // Mark both as resolved so components stop falling back to the
          // server props of the previous (signed-in) render.
          userHydrated: true,
          conversations: [],
          conversationsLoading: false,
          conversationsHydrated: true,
          currentConversationId: undefined,
          chatState: {},
          drafts: {},
          draftsOwner: null,
          // sidebarCollapsed stays (persisted)
        });
      },
    }),
    {
      name: 'chatterstack-storage',
      storage: persistedStorage,
      // Rehydrate after mount so the server HTML and the first client render
      // agree on `sidebarCollapsed`. Rehydrating during the first render
      // caused hydration mismatches.
      skipHydration: true,
      partialize: (state): PersistedState => ({
        sidebarCollapsed: state.sidebarCollapsed,
        drafts: state.drafts,
        draftsOwner: state.draftsOwner,
      }),
      onRehydrateStorage: () => () => {
        useAppStore.setState({ draftsHydrated: true });
      },
    }
  )
);
