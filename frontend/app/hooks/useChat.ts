import { useState, useCallback } from 'react';
import { ApiService } from '../services/api';
import type { Message, ChatState } from '../types';

const SUPPORTED_MODELS = [
  'deepseek/deepseek-chat-v3.1',
  'google/gemini-2.5-flash',
  'openai/gpt-4o',
];

export const useChat = () => {
  const [state, setState] = useState<ChatState>({
    messages: [],
    loading: false,
  });

  const sendMessage = useCallback(
    async (
      message: string,
      onConversationCreated?: (conversationId: string) => void
    ) => {
      if (!message.trim() || state.loading) return;

      console.log('=== Sending Message ===');
      console.log('Current conversation ID:', state.currentConversationId);
      console.log('Message:', message);

      const userMessage: Message = {
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        loading: true,
        error: undefined,
      }));

      const responses: Record<string, string> = {};
      SUPPORTED_MODELS.forEach((modelId) => {
        responses[modelId] = '';
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'assistant',
              content: '',
              modelId,
              createdAt: new Date().toISOString(),
            },
          ],
        }));
      });

      try {
        let newConversationId: string | undefined;

        await ApiService.sendMessage(
          {
            message,
            conversationId: state.currentConversationId,
          },
          (modelId: string, chunk: string) => {
            responses[modelId] += chunk;
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((msg) =>
                msg.role === 'assistant' && msg.modelId === modelId && !msg.id
                  ? { ...msg, content: responses[modelId] }
                  : msg
              ),
            }));
          },
          (modelId: string) => {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((msg) =>
                msg.role === 'assistant' && msg.modelId === modelId && !msg.id
                  ? { ...msg, content: responses[modelId], id: `${modelId}-${Date.now()}` }
                  : msg
              ),
            }));
          },
          (conversationId: string) => {
            if (!state.currentConversationId) {
              console.log('New conversation ID received:', conversationId);
              newConversationId = conversationId;
              setState((prev) => ({
                ...prev,
                currentConversationId: conversationId,
              }));
              if (onConversationCreated) {
                onConversationCreated(conversationId);
              }
            }
          }
        );

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
        }));
      }
    },
    [state.loading, state.currentConversationId]
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

        setState({
          messages,
          currentConversationId: conversationId,
          loading: false,
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
    });
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: undefined }));
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