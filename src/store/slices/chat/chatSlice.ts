import { StateCreator } from 'zustand';
import { Message } from '@/src/types/chat.types';

export interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

export interface ChatState {
  messages: Message[];
  loading: boolean;
  error?: string;
  councilProgress: CouncilProgress[];
}

export const initialChatState: ChatState = {
  messages: [],
  loading: false,
  error: undefined,
  councilProgress: [],
};

export interface ChatSlice {
  chatState: Record<string, ChatState>;
  setChatState: (conversationId: string, state: Partial<ChatState>) => void;
  clearChatState: (conversationId: string) => void;
}

export const createChatSlice: StateCreator<ChatSlice> = (set) => ({
  chatState: {},

  setChatState: (conversationId, updates) =>
    set((state) => ({
      chatState: {
        ...state.chatState,
        [conversationId]: {
          ...(state.chatState[conversationId] ?? initialChatState),
          ...updates,
        },
      },
    })),

  clearChatState: (conversationId) =>
    set((state) => {
      const rest = { ...state.chatState };
      delete rest[conversationId];
      return { chatState: rest };
    }),
});
