import { useCallback, useRef } from 'react';
import { ApiService } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import type { Message } from '../types';

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

export const useChatOptimized = () => {
  const currentConversationId = useAppStore((state) => state.currentConversationId);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const chatState = useAppStore((state) => 
    state.chatState[currentConversationId || 'new'] || {
      messages: [],
      loading: false,
      councilProgress: [],
    }
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

      const conversationKey = currentConversationId || 'new';
      const isCouncilMode = selectedModel === 'council';

      const userMessage: Message = {
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };

      // Add user message
      setChatState(conversationKey, {
        messages: [...chatState.messages, userMessage],
        loading: true,
        error: undefined,
        councilProgress: isCouncilMode ? [] : chatState.councilProgress,
      });

      // Add placeholder AI message
      const aiMessage: Message = {
        role: 'assistant',
        content: '',
        modelId: selectedModel,
        createdAt: new Date().toISOString(),
      };

      setChatState(conversationKey, {
        messages: [...chatState.messages, userMessage, aiMessage],
      });

      let fullResponse = '';

      try {
        const handleNewConversation = (id: string) => {
          if (!currentConversationId && id) {
            console.log('New conversation created:', id);
            setCurrentConversationId(id);
            
            // Reload conversations list
            loadConversations(true);
            
            if (onConversationCreated) {
              onConversationCreated(id);
            }
          }
        };

        if (isCouncilMode) {
          await ApiService.sendCouncilMessage(
            {
              message,
              conversationId: currentConversationId,
            },
            (chunk: string) => {
              fullResponse += chunk;
              const currentMessages = chatState.messages;
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse }
                  : msg
              );
              setChatState(conversationKey, { messages: updatedMessages });
            },
            (progress: CouncilProgress) => {
              const existing = chatState.councilProgress?.find(
                p => p.stage === progress.stage && p.model === progress.model
              );
              
              if (existing) {
                setChatState(conversationKey, {
                  councilProgress: chatState.councilProgress?.map(p =>
                    p.stage === progress.stage && p.model === progress.model
                      ? progress
                      : p
                  ),
                });
              } else {
                setChatState(conversationKey, {
                  councilProgress: [...(chatState.councilProgress || []), progress],
                });
              }
            },
            () => {
              const currentMessages = chatState.messages;
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse, id: `council-${Date.now()}` }
                  : msg
              );
              setChatState(conversationKey, { messages: updatedMessages });
            },
            handleNewConversation
          );
        } else {
          await ApiService.sendMessage(
            {
              message,
              conversationId: currentConversationId,
              selectedModel,
            },
            (chunk: string) => {
              fullResponse += chunk;
              const currentMessages = chatState.messages;
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse }
                  : msg
              );
              setChatState(conversationKey, { messages: updatedMessages });
            },
            () => {
              const currentMessages = chatState.messages;
              const updatedMessages = currentMessages.map((msg, idx) =>
                idx === currentMessages.length - 1 && msg.role === 'assistant' && !msg.id
                  ? { ...msg, content: fullResponse, id: `${selectedModel}-${Date.now()}` }
                  : msg
              );
              setChatState(conversationKey, { messages: updatedMessages });
            },
            handleNewConversation
          );
        }

      } catch (error) {
        console.error('Error sending message:', error);
        setChatState(conversationKey, {
          error: error instanceof Error ? error.message : 'Failed to send message. Please try again.',
          messages: chatState.messages.filter((msg) => msg.role !== 'assistant' || msg.id),
        });
      } finally {
        setChatState(conversationKey, {
          loading: false,
          councilProgress: [],
        });
        isSendingRef.current = false;
      }
    },
    [
      currentConversationId,
      selectedModel,
      chatState,
      setChatState,
      setCurrentConversationId,
      loadConversations,
    ]
  );

  const startNewConversation = useCallback(() => {
    setCurrentConversationId(undefined);
    setChatState('new', {
      messages: [],
      loading: false,
      error: undefined,
      councilProgress: [],
    });
    isSendingRef.current = false;
  }, [setCurrentConversationId, setChatState]);

  const clearError = useCallback(() => {
    const conversationKey = currentConversationId || 'new';
    setChatState(conversationKey, { error: undefined });
  }, [currentConversationId, setChatState]);

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