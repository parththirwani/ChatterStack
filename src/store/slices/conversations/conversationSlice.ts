import { StateCreator } from 'zustand';
import { ApiService } from '../../../services/api';
import type { Conversation, Message } from '../../../types';

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
    const { user, conversations, conversationsLoading, setConversations, setConversationsLoading } = get() as any; // temporary any – will improve later

    if (!user || user.id === 'guest' || (conversationsLoading && !force)) return;
    if (conversations.length > 0 && !force) return;

    try {
      setConversationsLoading(true);
      const result = await ApiService.getConversations();
      const convos = result.conversations || [];
      const sortedConvos = convos.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setConversations(sortedConvos);
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setConversations([]);
    } finally {
      setConversationsLoading(false);
    }
  },

  loadConversation: async (conversationId: string) => {
    const { setChatState, setCurrentConversationId, chatState } = get() as any;

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
        if (messages.length > 0) {
          console.log(`[Store] First message role: ${messages[0]?.role}`);
          console.log(`[Store] Last message role: ${messages[messages.length - 1]?.role}`);
        }

        setChatState(conversationId, {
          messages,
          loading: false,
          error: undefined,
          councilProgress: [],
        });

        setCurrentConversationId(conversationId);
      } else {
        throw new Error('Invalid conversation data received');
      }
    } catch (error) {
      console.error('[Store] Error loading conversation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load conversation.';
      setChatState(conversationId, {
        loading: false,
        error: errorMessage,
        messages: [],
        councilProgress: [],
      });
    }
  },

  deleteConversation: async (conversationId: string) => {
    const { removeConversation, clearChatState } = get() as any;
    try {
      await ApiService.deleteConversation(conversationId);
      removeConversation(conversationId);
      clearChatState(conversationId);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  },
});