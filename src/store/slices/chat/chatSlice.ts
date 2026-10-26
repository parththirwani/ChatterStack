import { StateCreator } from 'zustand';
import type { CouncilProgress, Message } from '@/src/types/chat.types';

export type { CouncilProgress };

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
  /** Move an in-flight state from the draft key ('new') to the real conversation id. */
  moveChatState: (from: string, to: string) => void;
  clearChatState: (conversationId: string) => void;
}

export const createChatSlice: StateCreator<ChatSlice> = (set) => ({
  chatState: {},

  setChatState: (conversationId, updates) =>
    set((state) => {
      const current = state.chatState[conversationId] ?? initialChatState;
      return {
        chatState: {
          ...state.chatState,
          [conversationId]: { ...current, ...updates },
        },
      };
    }),

  moveChatState: (from, to) =>
    set((state) => {
      if (from === to || !state.chatState[from]) return state;

      const chatState = { ...state.chatState };
      const moved = chatState[from];
      const target = chatState[to];
      delete chatState[from];
      chatState[to] = target ? { ...target, ...moved } : moved;
      return { chatState };
    }),

  clearChatState: (conversationId) =>
    set((state) => {
      if (!(conversationId in state.chatState)) return state;
      const rest = { ...state.chatState };
      delete rest[conversationId];
      return { chatState: rest };
    }),
});
