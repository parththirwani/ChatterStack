// frontend/app/hooks/useChat.ts
import { useState, useCallback } from 'react';
import { ApiService } from '../services/api';
import type { Message, ChatState } from '../types';

export const useChat = () => {
  const [state, setState] = useState<ChatState>({
    messages: [],
    loading: false,
  });

  const sendMessage = useCallback(async (
    message: string, 
    model: string = 'openai/gpt-4o-mini' // Default to a cheaper model
  ) => {
    if (!message.trim() || state.loading) return;

    // Add user message immediately
    const userMessage: Message = {
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      loading: true,
      error: undefined,
    }));

    // Add placeholder for AI response
    const aiMessage: Message = {
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, aiMessage],
    }));

    try {
      let accumulatedContent = '';

      const result = await ApiService.sendMessage(
        {
          message,
          model,
          conversationId: state.currentConversationId,
        },
        (chunk: string) => {
          // Update AI message content as chunks arrive
          accumulatedContent += chunk;
          setState(prev => ({
            ...prev,
            messages: prev.messages.map((msg, index) =>
              index === prev.messages.length - 1 && msg.role === 'assistant'
                ? { ...msg, content: accumulatedContent }
                : msg
            ),
          }));
        },
        (conversationId: string) => {
          // Set conversation ID when received
          setState(prev => ({
            ...prev,
            currentConversationId: conversationId,
          }));
        }
      );

      // Update conversation ID if it was newly created
      if (result.conversationId && !state.currentConversationId) {
        setState(prev => ({
          ...prev,
          currentConversationId: result.conversationId,
        }));
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to send message. Please try again.',
        // Remove the failed AI message
        messages: prev.messages.slice(0, -1),
      }));
    } finally {
      setState(prev => ({
        ...prev,
        loading: false,
      }));
    }
  }, [state.loading, state.currentConversationId]);

  const loadConversation = useCallback(async (conversationId: string) => {
    setState(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const result = await ApiService.getConversation(conversationId);
      if (result?.conversation) {
        setState({
          messages: result.conversation.messages.map(msg => ({
            ...msg,
            role: msg.role as 'user' | 'assistant'
          })),
          currentConversationId: conversationId,
          loading: false,
        });
      } else {
        throw new Error('Conversation not found');
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to load conversation.',
      }));
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setState({
      messages: [],
      currentConversationId: undefined,
      loading: false,
    });
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: undefined }));
  }, []);

  return {
    messages: state.messages,
    loading: state.loading,
    error: state.error,
    currentConversationId: state.currentConversationId,
    sendMessage,
    loadConversation,
    startNewConversation,
    clearError,
  };
};