import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createUserSlice, UserSlice } from './slices/user/userSlice';
import { createChatSlice, ChatSlice } from './slices/chat/chatSlice';
import { createUISlice, UISlice } from './slices/ui/uiSlice';
import { ConversationsSlice, createConversationsSlice } from './slices/conversations/conversationSlice';

// Export the full AppState type
export type AppState = UserSlice &
  ChatSlice &
  ConversationsSlice &
  UISlice & {
    reset: () => void;
  };

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ...createUserSlice(set, get, store),
      ...createChatSlice(set, get, store),
      ...createConversationsSlice(set, get, store),
      ...createUISlice(set, get, store),

      reset: () =>
        set({
          user: null,
          userLoading: false,
          conversations: [],
          conversationsLoading: false,
          currentConversationId: undefined,
          chatState: {},
          // sidebarCollapsed stays (persisted)
        }),
    }),
    {
      name: 'chatterstack-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);