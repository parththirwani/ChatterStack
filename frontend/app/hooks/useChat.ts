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

  const isSendingRef = useRef(false);
  const conversationCreatedRef = useRef(false);
  
  const currentConversationId = useMemo(() => state.currentConversationId, [state.currentConversationId]);

  const sendMessage = useCallback(
    async (
      message: string,
      onConversationCreated?: (conversationId: string) => void
    ) => {
      if (!message.trim() || isSendingRef.current) {
        console.log('Message send blocked');
        return;
      }

      isSendingRef.current = true;

      console.log('=== Sending Message ===');
      console.log('Selected model:', selectedModel);
      console.log('Current conversation ID:', state.currentConversationId);
      console.log('Message:', message);

      // Use current conversation ID from state
      const conversationId = state.currentConversationId;
      const isCouncilMode = selectedModel === 'council';

      const userMessage: Message = {
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };

      // Add user message immediately
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
        const handleNewConversation = (id: string) => {
          console.log('Conversation ID received from backend:', id);
          console.log('Current conversation ID in state:', state.currentConversationId);
          console.log('Already notified:', conversationCreatedRef.current);
          
          // Only trigger callback for TRULY NEW conversations (when we don't have an ID yet)
          if (!conversationId && id && !conversationCreatedRef.current) {
            console.log('✅ NEW conversation - updating state and notifying parent');
            conversationCreatedRef.current = true;
            
            // Update state with new conversation ID
            setState((prev) => ({
              ...prev,
              currentConversationId: id,
            }));

            // Notify parent component ONCE
            if (onConversationCreated) {
              onConversationCreated(id);
            }
          } else if (conversationId && id === conversationId) {
            console.log('⏭️ EXISTING conversation - no action needed');
            // Just update the conversation ID in state to be safe
            setState((prev) => ({
              ...prev,
              currentConversationId: id,
            }));
          } else {
            console.log('⚠️ Unexpected conversation ID scenario - ignoring');
          }
        };

        if (isCouncilMode) {
          console.log('Using council mode with conversation ID:', conversationId);
          await ApiService.sendCouncilMessage(
            {
              message,
              conversationId, // Pass existing conversation ID to maintain context
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
              console.log('Council message complete');
              setState((prev) => ({
                ...prev,
                messages: prev.messages.map((msg, idx) =>
                  idx === prev.messages.length - 1 && msg.role === 'assistant' && !msg.id
                    ? { ...msg, content: fullResponse, id: `council-${Date.now()}` }
                    : msg
                ),
              }));
            },
            handleNewConversation
          );
        } else {
          console.log('Using regular chat mode with conversation ID:', conversationId);
          await ApiService.sendMessage(
            {
              message,
              conversationId, // Pass existing conversation ID
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
              console.log('Regular message complete');
              setState((prev) => ({
                ...prev,
                messages: prev.messages.map((msg, idx) =>
                  idx === prev.messages.length - 1 && msg.role === 'assistant' && !msg.id
                    ? { ...msg, content: fullResponse, id: `${selectedModel}-${Date.now()}` }
                    : msg
                ),
              }));
            },
            handleNewConversation
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
    conversationCreatedRef.current = true; // Mark as existing conversation

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
    setState({
      messages: [],
      currentConversationId: undefined,
      loading: false,
      error: undefined,
      councilProgress: [],
    });
    isSendingRef.current = false;
    conversationCreatedRef.current = false; // Reset for new conversation
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