import { AppState } from '../../rootStore';
import { initialChatState } from './chatSlice';

export const selectChatStateForConversation = (conversationId: string) => 
  (state: AppState) => state.chatState[conversationId] || initialChatState;

export const selectMessages = (conversationId: string) => 
  (state: AppState) => state.chatState[conversationId]?.messages || [];

export const selectChatLoading = (conversationId: string) => 
  (state: AppState) => state.chatState[conversationId]?.loading || false;

export const selectChatError = (conversationId: string) => 
  (state: AppState) => state.chatState[conversationId]?.error;

export const selectCouncilProgress = (conversationId: string) => 
  (state: AppState) => state.chatState[conversationId]?.councilProgress || [];