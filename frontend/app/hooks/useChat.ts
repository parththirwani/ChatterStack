import { useState, useCallback, useRef, useMemo } from 'react';
import { ApiService } from '../services/api';
import type { Message, ChatState } from '../types';
import { useModelSelection } from '../context/ModelSelectionContext';

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

interface ExtendedChatState extends ChatState {
  councilProgress?: CouncilProgress[];
}

export const useChat = () => {
  const { selectedModel } = useModelSelection();
  const [state, setState] = useState<ExtendedChatState>({
    messages: [],
    loading: false,
    councilProgress: [],
  });

  // Use ref to track if we're currently sending to prevent duplicate sends
  const isSendingRef = useRef(false);
  
  // Memoize current conversation ID to prevent unnecessary re-renders
  const currentConversationId = useMemo(() => state.currentConversationId, [state.currentConversationId]);

  const sendMessage = useCallback(
    async (
      message: string,
      onConversationCreated?: (conversationId: string) => void
    ) => {
      if (!message.trim() || isSendingRef.current) {
        console.log('Message send blocked:', { 
          empty: !message.trim(), 
          alreadySending: isSendingRef.current 
        });
        return;
      }

      isSendingRef.current = true;

      console.log('=== Sending Message ===');
      console.log('Selected model:', selectedModel);
      console.log('Message:', message);

      // Get current conversation ID from state at time of send
      const conversationId = state.currentConversationId;
      const isCouncilMode = selectedModel === 'council';

      const userMessage: Message = {
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };

      // Use functional update to prevent stale state
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        loading: true,
        error: undefined,
        councilProgress: isCouncilMode ? [] : prev.councilProgress,
      }));

      // Create placeholder AI message
      const aiMessage: Message = {
        role: 'assistant',
        content: '',
        modelId: selectedModel,
        createdAt: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, aiMessage],
      }));

      let fullResponse = '';

      try {
        if (isCouncilMode) {
          // Use council endpoint
          await ApiService.sendCouncilMessage(
            {
              message,
              conversationId,
            },
            (chunk: string) => {
              fullResponse += chunk;
              setState((prev) => ({
                ...prev,
                messages: prev.messages.map((msg, idx) =>
                  idx === prev.messages.length - 1 && msg.role === 'assistant' && !msg.id
                    ? { ...msg, content: fullResponse }
                    : msg
                ),
              }));
            },
            (progress: CouncilProgress) => {
              setState((prev) => {
                const existing = prev.councilProgress?.find(
                  p => p.stage === progress.stage && p.model === progress.model
                );
                
                if (existing) {
                  return {
                    ...prev,
                    councilProgress: prev.councilProgress?.map(p =>
                      p.stage === progress.stage && p.model === progress.model
                        ? progress
                        : p
                    ),
                  };
                } else {
                  return {
                    ...prev,
                    councilProgress: [...(prev.councilProgress || []), progress],
                  };
                }
              });
            },
            () => {
              setState((prev) => ({
                ...prev,
                messages: prev.messages.map((msg, idx) =>
                  idx === prev.messages.length - 1 && msg.role === 'assistant' && !msg.id
                    ? { ...msg, content: fullResponse, id: `council-${Date.now()}` }
                    : msg
                ),
              }));
            },
            (newConversationId: string) => {
              if (!conversationId && newConversationId) {
                console.log('New conversation ID received:', newConversationId);
                setState((prev) => ({
                  ...prev,
                  currentConversationId: newConversationId,
                }));
                if (onConversationCreated) {
                  onConversationCreated(newConversationId);
                }
              }
            }
          );
        } else {
          // Use regular chat endpoint
          await ApiService.sendMessage(
            {
              message,
              conversationId,
              selectedModel,
            },
            (chunk: string) => {
              fullResponse += chunk;
              setState((prev) => ({
                ...prev,
                messages: prev.messages.map((msg, idx) =>
                  idx === prev.messages.length - 1 && msg.role === 'assistant' && !msg.id
                    ? { ...msg, content: fullResponse }
                    : msg
                ),
              }));
            },
            () => {
              setState((prev) => ({
                ...prev,
                messages: prev.messages.map((msg, idx) =>
                  idx === prev.messages.length - 1 && msg.role === 'assistant' && !msg.id
                    ? { ...msg, content: fullResponse, id: `${selectedModel}-${Date.now()}` }
                    : msg
                ),
              }));
            },
            (newConversationId: string) => {
              if (!conversationId && newConversationId) {
                console.log('New conversation ID received:', newConversationId);
                setState((prev) => ({
                  ...prev,
                  currentConversationId: newConversationId,
                }));
                if (onConversationCreated) {
                  onConversationCreated(newConversationId);
                }
              }
            }
          );
        }

      } catch (error) {
        console.error('Error sending message:', error);
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to send message. Please try again.',
          messages: prev.messages.filter((msg) => msg.role !== 'assistant' || msg.id),
        }));
      } finally {
        setState((prev) => ({
          ...prev,
          loading: false,
          councilProgress: [],
        }));
        isSendingRef.current = false;
      }
    },
    [selectedModel, state.currentConversationId]
  );

  const loadConversation = useCallback(async (conversationId: string) => {
    console.log('=== Loading Conversation ===');
    console.log('Conversation ID:', conversationId);

    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    try {
      const result = await ApiService.getConversation(conversationId);
      console.log('Conversation loaded:', result);

      if (result?.conversation) {
        const messages = result.conversation.messages.map((msg) => ({
          ...msg,
          role: msg.role as 'user' | 'assistant',
          modelId: msg.modelId,
        }));

        console.log('Setting messages:', messages);

        // Use a single state update to prevent flickering
        setState({
          messages,
          currentConversationId: conversationId,
          loading: false,
          councilProgress: [],
        });
      } else {
        throw new Error('Conversation not found');
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: 'Failed to load conversation.',
      }));
    }
  }, []);

  const startNewConversation = useCallback(() => {
    console.log('=== Starting New Conversation ===');
    // Single state update to prevent flickering
    setState({
      messages: [],
      currentConversationId: undefined,
      loading: false,
      error: undefined,
      councilProgress: [],
    });
    isSendingRef.current = false;
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: undefined }));
  }, []);

  return {
    messages: state.messages,
    loading: state.loading,
    error: state.error,
    councilProgress: state.councilProgress || [],
    currentConversationId,
    sendMessage,
    loadConversation,
    startNewConversation,
    clearError,
  };
};