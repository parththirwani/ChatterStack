import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User, Conversation, Message } from '../types';
import { ApiService } from '../services/api';

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

interface ChatState {
  messages: Message[];
  loading: boolean;
  error?: string;
  councilProgress: CouncilProgress[];
}

interface AppState {
  // User state
  user: User | null;
  userLoading: boolean;
  setUser: (user: User | null) => void;
  setUserLoading: (loading: boolean) => void;
  
  // Conversations state
  conversations: Conversation[];
  conversationsLoading: boolean;
  currentConversationId?: string;
  setConversations: (conversations: Conversation[]) => void;
  setConversationsLoading: (loading: boolean) => void;
  setCurrentConversationId: (id: string | undefined) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;
  
  // Chat state
  chatState: Record<string, ChatState>; // Key is conversationId or 'new'
  setChatState: (conversationId: string, state: Partial<ChatState>) => void;
  clearChatState: (conversationId: string) => void;
  
  // UI state
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  
  // ❌ REMOVED: selectedModel (now managed by ModelSelectionContext)
  // We don't need it here because MessageInput uses ModelSelectionContext
  
  // Actions
  initializeUser: () => Promise<void>;
  loadConversations: (force?: boolean) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  logout: () => Promise<void>;
  
  // Reset states
  reset: () => void;
}

const initialChatState: ChatState = {
  messages: [],
  loading: false,
  error: undefined,
  councilProgress: [],
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      userLoading: true,
      conversations: [],
      conversationsLoading: false,
      currentConversationId: undefined,
      chatState: {},
      sidebarCollapsed: false,
      // ❌ REMOVED: selectedModel: 'deepseek/deepseek-chat-v3.1',
      
      // User actions
      setUser: (user) => set({ user }),
      setUserLoading: (userLoading) => set({ userLoading }),
      
      // Conversations actions
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
      
      // Chat state actions
      setChatState: (conversationId, updates) =>
        set((state) => ({
          chatState: {
            ...state.chatState,
            [conversationId]: {
              ...(state.chatState[conversationId] || initialChatState),
              ...updates,
            },
          },
        })),
      
      clearChatState: (conversationId) =>
        set((state) => {
          const newChatState = { ...state.chatState };
          delete newChatState[conversationId];
          return { chatState: newChatState };
        }),
      
      // UI actions
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      // ❌ REMOVED: setSelectedModel
      
      // Async actions
      initializeUser: async () => {
        const { setUser, setUserLoading } = get();
        
        try {
          setUserLoading(true);
          const currentUser = await ApiService.getCurrentUser();
          setUser(currentUser);
        } catch (error) {
          console.error('Failed to initialize user:', error);
          setUser(null);
        } finally {
          setUserLoading(false);
        }
      },
      
      loadConversations: async (force = false) => {
        const { user, conversations, conversationsLoading, setConversations, setConversationsLoading } = get();
        
        // Don't load if not authenticated or already loading
        if (!user || user.id === 'guest' || (conversationsLoading && !force)) {
          return;
        }
        
        // Skip if we already have conversations and not forcing reload
        if (conversations.length > 0 && !force) {
          return;
        }
        
        try {
          setConversationsLoading(true);
          const convos = await ApiService.getConversations();
          
          const sortedConvos = convos.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
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
        const { setChatState, setCurrentConversationId } = get();
        
        try {
          setChatState(conversationId, { loading: true, error: undefined });
          
          const result = await ApiService.getConversation(conversationId);
          
          if (result?.conversation) {
            const messages = result.conversation.messages.map((msg) => ({
              ...msg,
              role: msg.role as 'user' | 'assistant',
              modelId: msg.modelId,
            }));
            
            setChatState(conversationId, {
              messages,
              loading: false,
              councilProgress: [],
            });
            
            setCurrentConversationId(conversationId);
          } else {
            throw new Error('Conversation not found');
          }
        } catch (error) {
          console.error('Error loading conversation:', error);
          setChatState(conversationId, {
            loading: false,
            error: 'Failed to load conversation.',
          });
        }
      },
      
      deleteConversation: async (conversationId: string) => {
        const { removeConversation, clearChatState } = get();
        
        try {
          await ApiService.deleteConversation(conversationId);
          removeConversation(conversationId);
          clearChatState(conversationId);
        } catch (error) {
          console.error('Failed to delete conversation:', error);
          throw error;
        }
      },
      
      logout: async () => {
        try {
          await ApiService.logout();
          get().reset();
        } catch (error) {
          console.error('Logout error:', error);
          throw error;
        }
      },
      
      // Reset all state
      reset: () =>
        set({
          user: null,
          userLoading: false,
          conversations: [],
          conversationsLoading: false,
          currentConversationId: undefined,
          chatState: {},
        }),
    }),
    {
      name: 'chatterstack-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist UI preferences
        // ❌ REMOVED: selectedModel (handled by ModelSelectionContext with its own persistence)
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);

// Selectors for better performance
export const useUser = () => useAppStore((state) => state.user);
export const useUserLoading = () => useAppStore((state) => state.userLoading);
export const useConversations = () => useAppStore((state) => state.conversations);
export const useConversationsLoading = () => useAppStore((state) => state.conversationsLoading);
export const useCurrentConversationId = () => useAppStore((state) => state.currentConversationId);
export const useSidebarCollapsed = () => useAppStore((state) => state.sidebarCollapsed);
// ❌ REMOVED: useSelectedModel (use useModelSelection from context instead)

// Get chat state for specific conversation
export const useChatState = (conversationId: string) =>
  useAppStore((state) => state.chatState[conversationId] || initialChatState);