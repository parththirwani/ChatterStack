import { StateCreator } from 'zustand';
import type { ChatState } from '../../../types'; // adjust path

const initialChatState: ChatState = {
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
          ...(state.chatState[conversationId] || initialChatState),
          ...updates,
        },
      },
    })),

  clearChatState: (conversationId) =>
    set((state) => {
      const { [conversationId]: removed, ...rest } = state.chatState;
      return { chatState: rest };
    }),
});