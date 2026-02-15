import { StateCreator } from 'zustand';
import { ApiService } from '../../../app/services/api';
import type { Conversation } from '../../../app/types';
import type { Message, ChatState, initialChatState } from '../chat/chatSlice';

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

  setConversations: (conversations: Conversation[]) => void;
  setConversationsLoading: (loading: boolean) => void;
  setCurrentConversationId: (id: string | undefined) => void;

  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;

  loadConversations: (force?: boolean) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
}

// Helper type for accessing other slices
interface StoreWithChat {
  user: any;
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

    console.log(`[Store] Loading conversation: ${conversationId}`);

    try {
      setChatState(conversationId, { loading: true, error: undefined });

      const result = await ApiService.getConversation(conversationId);
      console.log('[Store] API Result:', result);

      if (result && result.conversation) {
        const conversation = result.conversation;
        const messagesArray = Array.isArray(conversation.messages) ? conversation.messages : [];

        const messages = sortMessagesByCreatedAt(
          messagesArray.map((msg: any) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            content: msg.content || '',
            modelId: msg.modelId,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
          }))
        );

        console.log(`[Store] Loaded ${messages.length} messages in chronological order`);

        setChatState(conversationId, {
          messages,
          loading: false,
          error: undefined,
          councilProgress: [],
        });

        set({ currentConversationId: conversationId });
      } else {
        throw new Error('Invalid conversation data received');
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