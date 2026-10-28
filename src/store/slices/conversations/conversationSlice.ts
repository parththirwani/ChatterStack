import { StateCreator } from 'zustand';
import { ApiService } from '../../../services/api';
import type { Conversation } from '../../../types/conversation.types';
import type { Message } from '../../../types/chat.types';
import type { ChatState } from '../chat/chatSlice';


/** Same order the server reads in: saved position, then time. */
const sortMessages = (messages: Message[]): Message[] => {
  const time = (message: Message) => new Date(message.createdAt || 0).getTime();
  // Messages with no position predate the column, so they sort first.
  return [...messages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || time(a) - time(b));
};

/** Pinned chats first (most recently pinned on top), then most recent activity. */
export function sortConversations(conversations: Conversation[]): Conversation[] {
  const time = (value?: string | null) => (value ? new Date(value).getTime() : 0);
  return [...conversations].sort(
    (a, b) => time(b.pinnedAt) - time(a.pinnedAt) || time(b.updatedAt) - time(a.updatedAt)
  );
}

export interface ConversationsSlice {
  conversations: Conversation[];
  conversationsLoading: boolean;
  /** True once the list has been seeded from SSR or loaded from the API. */
  conversationsHydrated: boolean;
  currentConversationId?: string;

  setConversations: (conversations: Conversation[]) => void;
  setConversationsLoading: (loading: boolean) => void;
  setCurrentConversationId: (id: string | undefined) => void;
  hydrateConversation: (conversation: Conversation) => void;

  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;

  renameConversation: (id: string, title: string) => Promise<void>;
  setConversationPinned: (id: string, pinned: boolean) => Promise<void>;
  /**
   * Forks a chat at one saved message and makes the copy the active chat.
   * Resolves with the conversation the server created.
   */
  forkConversation: (conversationId: string, messageId: string) => Promise<Conversation>;

  loadConversations: (force?: boolean) => Promise<void>;
  /**
   * Load a conversation's messages once, for client-side switches and hover
   * prefetch. Never replaces messages already in memory.
   */
  fetchConversation: (conversationId: string) => Promise<void>;
  /** Conversations the API said don't exist (or aren't the user's). */
  missingConversationIds: Record<string, true>;
  deleteConversation: (conversationId: string) => Promise<void>;
}

// In-flight conversation loads, so a hover prefetch and the click share one request.
const conversationRequests = new Map<string, Promise<void>>();

// Helper type for accessing other slices
interface StoreWithChat {
  user: { id?: string };
  conversations: Conversation[];
  conversationsLoading: boolean;
  chatState: Record<string, ChatState>;
  setChatState: (id: string, state: Partial<ChatState>) => void;
  setCurrentConversationId: (id: string | undefined) => void;
  clearChatState: (id: string) => void;
  clearQueue: (id: string) => void;
}

export const createConversationsSlice: StateCreator<
  ConversationsSlice,
  [],
  [],
  ConversationsSlice
> = (set, get) => ({
  conversations: [],
  conversationsLoading: false,
  conversationsHydrated: false,
  currentConversationId: undefined,
  missingConversationIds: {},

  setConversations: (conversations) =>
    set({ conversations, conversationsHydrated: true }),
  setConversationsLoading: (conversationsLoading) => set({ conversationsLoading }),
  setCurrentConversationId: (currentConversationId) => {
    if (get().currentConversationId === currentConversationId) return;
    set({ currentConversationId });
  },

  hydrateConversation: (conversation) => {
    const state = get() as unknown as ConversationsSlice & StoreWithChat;
    const existing = state.chatState[conversation.id];

    if (!existing?.messages.length) {
      state.setChatState(conversation.id, {
        messages: conversation.messages ?? [],
        loading: false,
        error: undefined,
        councilProgress: [],
      });
    }

    const hasConversation = state.conversations.some((item) => item.id === conversation.id);
    set({
      conversations: hasConversation
        ? state.conversations
        : [conversation, ...state.conversations],
    });
  },

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  updateConversation: (id, updates) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === id ? { ...conv, ...updates } : conv
      ),
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((conv) => conv.id !== id),
      currentConversationId:
        state.currentConversationId === id ? undefined : state.currentConversationId,
    })),

  renameConversation: async (id, title) => {
    const previous = get().conversations.find((conv) => conv.id === id);
    if (!previous || previous.title === title) return;
    get().updateConversation(id, { title });
    try {
      await ApiService.updateConversation(id, { title });
    } catch (error) {
      get().updateConversation(id, { title: previous.title });
      throw error;
    }
  },

  setConversationPinned: async (id, pinned) => {
    const previous = get().conversations.find((conv) => conv.id === id);
    if (!previous) return;
    get().updateConversation(id, { pinnedAt: pinned ? new Date().toISOString() : null });
    try {
      const saved = await ApiService.updateConversation(id, { pinned });
      // Use the server's timestamp so ordering matches after a reload.
      get().updateConversation(id, { pinnedAt: saved.pinnedAt });
    } catch (error) {
      get().updateConversation(id, { pinnedAt: previous.pinnedAt ?? null });
      throw error;
    }
  },

  forkConversation: async (conversationId, messageId) => {
    // Nothing is created client-side: the saved rows are the answer, so the
    // fork only appears once the server has written them.
    const conversation = await ApiService.forkConversation(conversationId, messageId);
    // hydrateConversation puts it in Recents and seeds its messages, and leaves
    // any chat that is streaming right now exactly as it is.
    get().hydrateConversation({ ...conversation, messages: sortMessages(conversation.messages ?? []) });
    (get() as unknown as StoreWithChat).setCurrentConversationId(conversation.id);
    return conversation;
  },

  loadConversations: async (force = false) => {
    const state = get() as unknown as StoreWithChat;
    const { user, conversations, conversationsLoading } = state;

    if (!user || user.id === 'guest' || (conversationsLoading && !force)) return;
    if (conversations.length > 0 && !force) return;

    try {
      set({ conversationsLoading: true });
      const result = await ApiService.getConversations();
      set({ conversations: sortConversations(result.conversations || []), conversationsHydrated: true });
    } catch (error) {
      console.error('Failed to load conversations:', error);
      set({ conversations: [], conversationsHydrated: true });
    } finally {
      set({ conversationsLoading: false });
    }
  },

  fetchConversation: (conversationId: string) => {
    // Already in memory (SSR seed, a previous visit, or a chat streaming now).
    if ((get() as unknown as StoreWithChat).chatState[conversationId]?.messages.length) {
      return Promise.resolve();
    }
    const inFlight = conversationRequests.get(conversationId);
    if (inFlight) return inFlight;
    // A retry (e.g. after a network error) gets another chance.
    if (get().missingConversationIds[conversationId]) {
      set((state) => {
        const missingConversationIds = { ...state.missingConversationIds };
        delete missingConversationIds[conversationId];
        return { missingConversationIds };
      });
    }

    const request = ApiService.getConversation(conversationId)
      .then((result) => {
        if (result?.conversation) {
          get().hydrateConversation({
            ...result.conversation,
            messages: sortMessages(result.conversation.messages ?? []),
          });
        } else {
          set((state) => ({ missingConversationIds: { ...state.missingConversationIds, [conversationId]: true } }));
        }
      })
      .catch((error) => {
        // A network or server failure isn't "missing": show a retryable
        // error (clicking the chat again retries).
        console.error('[Store] Failed to load conversation:', error);
        (get() as unknown as StoreWithChat).setChatState(conversationId, {
          error: "Couldn't load this conversation. Check your connection and try again.",
        });
      })
      .finally(() => conversationRequests.delete(conversationId));
    conversationRequests.set(conversationId, request);
    return request;
  },

  deleteConversation: async (conversationId: string) => {
    const state = get() as unknown as StoreWithChat;
    
    try {
      await ApiService.deleteConversation(conversationId);
      
      // Remove from conversations list
      set((currentState) => ({
        conversations: currentState.conversations.filter((conv) => conv.id !== conversationId),
        currentConversationId:
          currentState.currentConversationId === conversationId
            ? undefined
            : currentState.currentConversationId,
      }));
      
      // Clear chat state, queued messages and any unsent draft
      state.clearChatState(conversationId);
      state.clearQueue(conversationId);
      (get() as unknown as { setDraft: (key: string, text: string) => void }).setDraft(conversationId, '');
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  },
});