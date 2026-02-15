
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { createUserSlice } from './slices/user/userSlice';
import { createChatSlice } from './slices/chat/chatSlice';
import { createConversationsSlice } from './slices/conversations/conversationsSlice';
import { createUISlice } from './slices/ui/uiSlice';

import type { UserSlice } from './slices/user/userSlice';
import type { ChatSlice } from './slices/chat/chatSlice';
import type { ConversationsSlice } from './slices/conversations/conversationsSlice';
import type { UISlice } from './slices/ui/uiSlice';

type AppState = UserSlice &
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