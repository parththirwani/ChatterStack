import { StateCreator } from 'zustand';
import { ApiService } from '../../../services/api';
import type { Conversation } from '../../../types/conversation.types';
import type { Message } from '../../../types/chat.types';
import type { ChatState } from '../chat/chatSlice';
import { OptimisticChat, optimisticChatManager } from '@/src/lib/api/chat/optimistic-chat-manager';


const sortMessagesByCreatedAt = (messages: Message[]): Message[] => {
  return [...messages].sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeA - timeB;
  });
};

export interface ConversationsSlice {
  conversations: Conversation[];
  conversationsLoading: boolean;
  currentConversationId?: string;
  optimisticChats: OptimisticChat[];

  setConversations: (conversations: Conversation[]) => void;
  setConversationsLoading: (loading: boolean) => void;
  setCurrentConversationId: (id: string | undefined) => void;

  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;

  createOptimisticChat: (userId: string, firstMessage: string) => string;
  linkOptimisticChatId: (tempId: string, realId: string) => void;
  finalizeOptimisticChat: (chatId: string, realConversation: Conversation) => void;
  updateOptimisticChatStatus: (
    chatId: string,
    status: OptimisticChat['status'],
    error?: string
  ) => void;
  removeOptimisticChat: (chatId: string) => void;
  refreshOptimisticChats: () => void;

  loadConversations: (force?: boolean) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  
  // NEW: Get merged list of real + optimistic chats
  getAllChatsForSidebar: () => (Conversation | OptimisticChat)[];
}

// Helper type for accessing other slices
interface StoreWithChat {
  user: { id?: string };
  conversations: Conversation[];
  conversationsLoading: boolean;
  chatState: Record<string, ChatState>;
  setChatState: (id: string, state: Partial<ChatState>) => void;
  clearChatState: (id: string) => void;
}

export const createConversationsSlice: StateCreator<
  ConversationsSlice,
  [],
  [],
  ConversationsSlice
> = (set, get) => ({
  conversations: [],
  conversationsLoading: false,
  currentConversationId: undefined,
  optimisticChats: [],

  setConversations: (conversations) => set({ conversations }),
  setConversationsLoading: (conversationsLoading) => set({ conversationsLoading }),
  setCurrentConversationId: (currentConversationId) => set({ currentConversationId }),

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

  // NEW: Optimistic chat methods
  createOptimisticChat: (userId: string, firstMessage: string) => {
    const optimisticChat = optimisticChatManager.createOptimisticChat({
      userId,
      firstMessage,
    });
    
    set({ optimisticChats: optimisticChatManager.getAllOptimisticChats() });
    return optimisticChat.tempId;
  },

  linkOptimisticChatId: (tempId: string, realId: string) => {
    optimisticChatManager.linkRealId(tempId, realId);
    set({ optimisticChats: optimisticChatManager.getAllOptimisticChats() });
  },

  finalizeOptimisticChat: (chatId: string, realConversation: Conversation) => {
    optimisticChatManager.finalizeChat(chatId, realConversation);
    
    // Add to real conversations if not already there
    const state = get();
    const exists = state.conversations.some((c) => c.id === realConversation.id);
    if (!exists) {
      set((s) => ({
        conversations: [realConversation, ...s.conversations],
      }));
    }
    
    // Cleanup completed optimistic chats
    setTimeout(() => {
      optimisticChatManager.cleanupCompleted();
      set({ optimisticChats: optimisticChatManager.getAllOptimisticChats() });
    }, 1000); // Delay cleanup to ensure smooth UI transition
  },

  updateOptimisticChatStatus: (
    chatId: string,
    status: OptimisticChat['status'],
    error?: string
  ) => {
    optimisticChatManager.updateStreamingStatus(chatId, status, error);
    set({ optimisticChats: optimisticChatManager.getAllOptimisticChats() });
  },

  removeOptimisticChat: (chatId: string) => {
    optimisticChatManager.removeChat(chatId);
    set({ optimisticChats: optimisticChatManager.getAllOptimisticChats() });
  },

  refreshOptimisticChats: () => {
    set({ optimisticChats: optimisticChatManager.getAllOptimisticChats() });
  },

  // NEW: Merged list for sidebar
  getAllChatsForSidebar: () => {
    const state = get();
    const merged: (Conversation | OptimisticChat)[] = [];
    const seenRealIds = new Set<string>();
    
    // Add optimistic chats first (they're more recent)
    for (const optimistic of state.optimisticChats) {
      merged.push(optimistic);
      // Track real ID to avoid duplicates
      if (optimistic.realId) {
        seenRealIds.add(optimistic.realId);
      }
    }
    
    // Add real conversations that aren't already represented by optimistic chats
    for (const conversation of state.conversations) {
      if (!seenRealIds.has(conversation.id)) {
        merged.push(conversation);
      }
    }
    
    // Sort by updatedAt descending
    return merged.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  },

  loadConversations: async (force = false) => {
    const state = get() as unknown as StoreWithChat;
    const { user, conversations, conversationsLoading } = state;

    if (!user || user.id === 'guest' || (conversationsLoading && !force)) return;
    if (conversations.length > 0 && !force) return;

    try {
      set({ conversationsLoading: true });
      const result = await ApiService.getConversations();
      const convos = result.conversations || [];
      const sortedConvos = convos.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      set({ conversations: sortedConvos });
    } catch (error) {
      console.error('Failed to load conversations:', error);
      set({ conversations: [] });
    } finally {
      set({ conversationsLoading: false });
    }
  },

  loadConversation: async (conversationId: string) => {
    const state = get() as unknown as StoreWithChat;
    const { setChatState } = state;


    // Check if this is a temp ID
    if (conversationId.startsWith('temp_')) {
      // Don't try to load from API - optimistic chat is already in state
      return;
    }

    try {
      setChatState(conversationId, { loading: true, error: undefined });

      const result = await ApiService.getConversation(conversationId);

      if (result && result.conversation) {
        const conversation = result.conversation;
        const messagesArray = Array.isArray(conversation.messages) ? conversation.messages : [];

        const messages = sortMessagesByCreatedAt(
          messagesArray.map((msg) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            content: msg.content || '',
            modelId: msg.modelId,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
          }))
        );


        setChatState(conversationId, {
          messages,
          loading: false,
          error: undefined,
          councilProgress: [],
        });

        set({ currentConversationId: conversationId });
      } else {
        throw new Error('Conversation not found or invalid data received');
      }
    } catch (error) {
      console.error('[Store] Error loading conversation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load conversation.';
      const state = get() as unknown as StoreWithChat;
      state.setChatState(conversationId, {
        loading: false,
        error: errorMessage,
        messages: [],
        councilProgress: [],
      });
    }
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
      
      // Clear chat state
      state.clearChatState(conversationId);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  },
});