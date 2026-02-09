import { useCallback, useRef } from 'react';
import { ApiService } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import type { Message } from '../types';

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

// Define default state outside component to maintain reference stability
const DEFAULT_CHAT_STATE = {
  messages: [],
  loading: false,
  councilProgress: [],
};

export const useChatOptimized = () => {
  const currentConversationId = useAppStore((state) => state.currentConversationId);
  const selectedModel = useAppStore((state) => state.selectedModel);
  
  // Use a stable selector with useCallback to prevent infinite loops
  const chatState = useAppStore(
    useCallback(
      (state) => {
        const key = currentConversationId || 'new';
        return state.chatState[key] || DEFAULT_CHAT_STATE;
      },
      [currentConversationId]
    )
  );
  
  const setChatState = useAppStore((state) => state.setChatState);
  const setCurrentConversationId = useAppStore((state) => state.setCurrentConversationId);
  const loadConversation = useAppStore((state) => state.loadConversation);
  const loadConversations = useAppStore((state) => state.loadConversations);
  
  const isSendingRef = useRef(false);

  const sendMessage = useCallback(
    async (
      message: string,
      onConversationCreated?: (conversationId: string) => void
    ) => {
      if (!message.trim() || isSendingRef.current) {
        return;
      }

      isSendingRef.current = true;

      // Get current state from store
      const store = useAppStore.getState();
      const conversationKey = store.currentConversationId || 'new';
      const isCouncilMode = store.selectedModel === 'council';
      const currentChatState = store.chatState[conversationKey] || DEFAULT_CHAT_STATE;

      const userMessage: Message = {
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };

      // Add user message
      store.setChatState(conversationKey, {
        messages: [...currentChatState.messages, userMessage],
        loading: true,
        error: undefined,
        councilProgress: isCouncilMode ? [] : currentChatState.councilProgress,
      });

      // Add placeholder AI message
      const aiMessage: Message = {
        role: 'assistant',
        content: '',
        modelId: store.selectedModel,
        createdAt: new Date().toISOString(),
      };

      // Get fresh state after adding user message
      const stateAfterUser = useAppStore.getState().chatState[conversationKey] || DEFAULT_CHAT_STATE;
      store.setChatState(conversationKey, {
        messages: [...stateAfterUser.messages, aiMessage],
      });

      let fullResponse = '';

      try {
        const handleNewConversation = (id: string) => {
          const currentState = useAppStore.getState();
          if (!currentState.currentConversationId && id) {
            console.log('New conversation created:', id);
            currentState.setCurrentConversationId(id);
            
            // Reload conversations list
            currentState.loadConversations(true);
            
            if (onConversationCreated) {
              onConversationCreated(id);
            }
          }
        };

        if (isCouncilMode) {
          await ApiService.sendCouncilMessage(
            {
              message,
              conversationId: store.currentConversationId,
            },
            (chunk: string) => {
              fullResponse += chunk;
              // Get fresh state for each chunk
              const freshState = useAppStore.getState();
              const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
              const currentMessages = freshChatState.messages;
              
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse }
                  : msg
              );
              freshState.setChatState(conversationKey, { messages: updatedMessages });
            },
            (progress: CouncilProgress) => {
              // Get fresh state for progress updates
              const freshState = useAppStore.getState();
              const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
              
              const existing = freshChatState.councilProgress?.find(
                p => p.stage === progress.stage && p.model === progress.model
              );
              
              if (existing) {
                freshState.setChatState(conversationKey, {
                  councilProgress: freshChatState.councilProgress?.map(p =>
                    p.stage === progress.stage && p.model === progress.model
                      ? progress
                      : p
                  ),
                });
              } else {
                freshState.setChatState(conversationKey, {
                  councilProgress: [...(freshChatState.councilProgress || []), progress],
                });
              }
            },
            () => {
              // Get fresh state when done
              const freshState = useAppStore.getState();
              const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
              const currentMessages = freshChatState.messages;
              
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse, id: `council-${Date.now()}` }
                  : msg
              );
              freshState.setChatState(conversationKey, { messages: updatedMessages });
            },
            handleNewConversation
          );
        } else {
          await ApiService.sendMessage(
            {
              message,
              conversationId: store.currentConversationId,
              selectedModel: store.selectedModel,
            },
            (chunk: string) => {
              fullResponse += chunk;
              // Get fresh state for each chunk
              const freshState = useAppStore.getState();
              const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
              const currentMessages = freshChatState.messages;
              
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse }
                  : msg
              );
              freshState.setChatState(conversationKey, { messages: updatedMessages });
            },
            () => {
              // Get fresh state when done
              const freshState = useAppStore.getState();
              const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
              const currentMessages = freshChatState.messages;
              
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse, id: `${store.selectedModel}-${Date.now()}` }
                  : msg
              );
              freshState.setChatState(conversationKey, { messages: updatedMessages });
            },
            handleNewConversation
          );
        }

      } catch (error) {
        console.error('Error sending message:', error);
        const finalState = useAppStore.getState();
        const finalChatState = finalState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
        
        finalState.setChatState(conversationKey, {
          error: error instanceof Error ? error.message : 'Failed to send message. Please try again.',
          messages: finalChatState.messages.filter((msg) => msg.role !== 'assistant' || msg.id),
        });
      } finally {
        const finalState = useAppStore.getState();
        finalState.setChatState(conversationKey, {
          loading: false,
          councilProgress: [],
        });
        isSendingRef.current = false;
      }
    },
    [] // No dependencies - we use getState() to get fresh values
  );

  const startNewConversation = useCallback(() => {
    const store = useAppStore.getState();
    store.setCurrentConversationId(undefined);
    store.setChatState('new', {
      messages: [],
      loading: false,
      error: undefined,
      councilProgress: [],
    });
    isSendingRef.current = false;
  }, []);

  const clearError = useCallback(() => {
    const store = useAppStore.getState();
    const conversationKey = store.currentConversationId || 'new';
    store.setChatState(conversationKey, { error: undefined });
  }, []);

  return {
    messages: chatState.messages,
    loading: chatState.loading,
    error: chatState.error,
    councilProgress: chatState.councilProgress || [],
    currentConversationId,
    sendMessage,
    loadConversation,
    startNewConversation,
    clearError,
  };
};