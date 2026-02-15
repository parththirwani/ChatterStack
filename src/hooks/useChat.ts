import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ApiService } from '../services/api';
import { useModelSelection } from '../context/ModelSelectionContext';
import { Message } from '@/src/types/chat.types';
import { useAppStore } from '@/src/store/rootStore';

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

const DEFAULT_CHAT_STATE = {
  messages: [],
  loading: false,
  councilProgress: [],
};

export const useChatOptimized = () => {
  const router = useRouter();
  const currentConversationId = useAppStore((state) => state.currentConversationId);
  const { selectedModel } = useModelSelection();
  
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
  
  // Optimistic chat methods
  const createOptimisticChat = useAppStore((state) => state.createOptimisticChat);
  const linkOptimisticChatId = useAppStore((state) => state.linkOptimisticChatId);
  const finalizeOptimisticChat = useAppStore((state) => state.finalizeOptimisticChat);
  const updateOptimisticChatStatus = useAppStore((state) => state.updateOptimisticChatStatus);
  const refreshOptimisticChats = useAppStore((state) => state.refreshOptimisticChats);
  const user = useAppStore((state) => state.user);
  
  const isSendingRef = useRef(false);

  const sendMessage = useCallback(
    async (
      message: string,
      onConversationCreated?: (conversationId: string) => void
    ) => {
      if (!message.trim() || isSendingRef.current || !user) {
        return;
      }

      isSendingRef.current = true;

      const store = useAppStore.getState();
      const isNewConversation = !store.currentConversationId;
      const isCouncilMode = selectedModel === 'council';
      
      let workingConversationId = store.currentConversationId;
      let tempId: string | undefined;

      // OPTIMISTIC: Create temporary chat for new conversations
      if (isNewConversation) {
        tempId = createOptimisticChat(user.id, message);
        workingConversationId = tempId;
        
        // 🔧 FIX: Use replace for smooth navigation without reload
        router.replace(`/${tempId}`, { scroll: false });
        setCurrentConversationId(tempId);
        
        console.log('[useChat] Created optimistic chat:', tempId);
      }

      const conversationKey = workingConversationId || 'new';
      const currentChatState = store.chatState[conversationKey] || DEFAULT_CHAT_STATE;

      // Create user message
      const userMessage: Message = {
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };

      // Add user message immediately
      store.setChatState(conversationKey, {
        messages: [...currentChatState.messages, userMessage],
        loading: true,
        error: undefined,
        councilProgress: isCouncilMode ? [] : currentChatState.councilProgress,
      });

      // Update optimistic status
      if (tempId) {
        updateOptimisticChatStatus(tempId, 'streaming');
      }

      // Add placeholder AI message
      const aiMessage: Message = {
        role: 'assistant',
        content: '',
        modelId: selectedModel,
        createdAt: new Date().toISOString(),
      };

      setTimeout(() => {
        const freshStore = useAppStore.getState();
        const freshChatState = freshStore.chatState[conversationKey] || DEFAULT_CHAT_STATE;
        freshStore.setChatState(conversationKey, {
          messages: [...freshChatState.messages, aiMessage],
        });
      }, 0);

      let fullResponse = '';
      let realConversationId: string | undefined;

      try {
        const handleNewConversation = (id: string) => {
          realConversationId = id;
          console.log('[useChat] Real conversation ID received:', id);
          
          const currentState = useAppStore.getState();
          
          // Link temp ID to real ID
          if (tempId) {
            linkOptimisticChatId(tempId, id);
            
            // 🔧 FIX: Use replace instead of push for smooth navigation
            router.replace(`/${id}`, { scroll: false });
          }
          
          if (!currentState.currentConversationId || currentState.currentConversationId === tempId) {
            currentState.setCurrentConversationId(id);
            
            if (onConversationCreated) {
              onConversationCreated(id);
            }
          }
        };

        const updateMessageContent = (content: string) => {
          const freshState = useAppStore.getState();
          const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
          const currentMessages = freshChatState.messages;
          
          const updatedMessages = currentMessages.map((msg, idx) =>
            idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
              ? { ...msg, content }
              : msg
          );
          freshState.setChatState(conversationKey, { messages: updatedMessages });
          
          // Update optimistic chat status
          if (tempId || realConversationId) {
            refreshOptimisticChats();
          }
        };

        const finalizeMessage = () => {
          const freshState = useAppStore.getState();
          const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
          const currentMessages = freshChatState.messages;
          
          const updatedMessages = currentMessages.map((msg, idx) =>
            idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
              ? { 
                  ...msg, 
                  content: fullResponse, 
                  id: `${selectedModel}-${Date.now()}`,
                  createdAt: new Date().toISOString()
                }
              : msg
          );
          freshState.setChatState(conversationKey, { messages: updatedMessages });
          
          // Finalize optimistic chat
          if (tempId && realConversationId) {
            // Load the real conversation to finalize
            loadConversations(true).then(() => {
              const conversation = freshState.conversations.find(c => c.id === realConversationId);
              if (conversation) {
                finalizeOptimisticChat(tempId, conversation);
              }
            });
          }
        };

        // Progress handler for council mode
        const handleProgress = (progress: CouncilProgress) => {
          const freshState = useAppStore.getState();
          const freshChatState = freshState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
          
          const existing = freshChatState.councilProgress?.find(
            p => p.stage === progress.stage && p.model === progress.model
          );
          
          const updatedProgress = existing
            ? freshChatState.councilProgress?.map(p =>
                p.stage === progress.stage && p.model === progress.model ? progress : p
              )
            : [...(freshChatState.councilProgress || []), progress];
          
          freshState.setChatState(conversationKey, {
            councilProgress: updatedProgress,
          });
        };

        if (isCouncilMode) {
          await ApiService.sendCouncilMessage(
            {
              message,
              conversationId: store.currentConversationId,
            },
            (chunk: string) => {
              fullResponse += chunk;
              updateMessageContent(fullResponse);
            },
            handleProgress,
            finalizeMessage,
            handleNewConversation
          );
        } else {
          await ApiService.sendMessage(
            {
              message,
              conversationId: store.currentConversationId,
              selectedModel: selectedModel,
            },
            (chunk: string) => {
              fullResponse += chunk;
              updateMessageContent(fullResponse);
            },
            finalizeMessage,
            handleNewConversation,
            undefined
          );
        }

      } catch (error) {
        const finalState = useAppStore.getState();
        const finalChatState = finalState.chatState[conversationKey] || DEFAULT_CHAT_STATE;
        
        finalState.setChatState(conversationKey, {
          error: error instanceof Error ? error.message : 'Failed to send message. Please try again.',
          messages: finalChatState.messages.filter((msg) => msg.role !== 'assistant' || msg.id),
        });
        
        // Update optimistic status to error
        if (tempId || realConversationId) {
          const chatId = realConversationId || tempId!;
          updateOptimisticChatStatus(
            chatId,
            'error',
            error instanceof Error ? error.message : 'Failed to send message'
          );
        }
      } finally {
        const finalState = useAppStore.getState();
        finalState.setChatState(conversationKey, {
          loading: false,
          councilProgress: [],
        });
        
        // Mark optimistic chat as complete
        if (tempId && realConversationId) {
          updateOptimisticChatStatus(realConversationId, 'complete');
        }
        
        isSendingRef.current = false;
      }
    },
    [
      selectedModel,
      user,
      router,
      createOptimisticChat,
      linkOptimisticChatId,
      finalizeOptimisticChat,
      updateOptimisticChatStatus,
      refreshOptimisticChats,
      setCurrentConversationId,
      loadConversations,
    ]
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