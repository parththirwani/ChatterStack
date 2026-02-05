// frontend/app/components/ChatInterface/ChatInterface.tsx
import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import MessageInput from './MessageInput';

import { ChatInterfaceProps, Message } from '@/app/types';
import { useChat } from '@/app/hooks/useChat';
import { useModelSelection } from '@/app/context/ModelSelectionContext';
import AIMessageWithActions from './AIMessage';
import UserMessage from './UserMessage';

interface ChatInterfaceExtendedProps extends ChatInterfaceProps {
  viewMode: 'all' | string;
}

const SUPPORTED_MODELS = [
  'deepseek/deepseek-chat-v3.1',
  'google/gemini-2.5-flash',
  'openai/gpt-4o',
  'anthropic/claude-sonnet-4.5',
] as const;

type SupportedModelId = typeof SUPPORTED_MODELS[number];

const modelNameMap: Record<string, string> = {
  'deepseek/deepseek-chat-v3.1': 'DeepSeek v3.1',
  'google/gemini-2.5-flash': 'Gemini Flash',
  'openai/gpt-4o': 'GPT-4o',
  'anthropic/claude-sonnet-4.5': 'Claude Sonnet 4.5',
};

const modelIconMap: Record<string, string> = {
  'deepseek/deepseek-chat-v3.1': '/deepseek.svg',
  'google/gemini-2.5-flash': '/gemini.svg',
  'openai/gpt-4o': '/openai.svg',
  'anthropic/claude-sonnet-4.5': '/claude.svg',
};

const ChatInterface: React.FC<ChatInterfaceExtendedProps> = ({
  selectedConversationId,
  onConversationCreated,
  viewMode,
}) => {
  const [message, setMessage] = useState('');
  const { isModelSelected } = useModelSelection();
  
  const {
    messages,
    loading,
    error,
    sendMessage,
    startNewConversation,
    loadConversation,
    clearError,
    currentConversationId,
  } = useChat();

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedConversation = useRef<string | undefined>(undefined);

  const isFirstMessage = messages.length === 0;

  // Get active models based on selection
  const activeModels = viewMode === 'all' 
    ? SUPPORTED_MODELS.filter(modelId => isModelSelected(modelId as SupportedModelId))
    : [viewMode];

  // Load conversation when selectedConversationId changes
  useEffect(() => {
    if (selectedConversationId === hasLoadedConversation.current) {
      return;
    }

    if (selectedConversationId && selectedConversationId !== currentConversationId) {
      console.log('Loading conversation:', selectedConversationId);
      loadConversation(selectedConversationId);
      hasLoadedConversation.current = selectedConversationId;
    } else if (!selectedConversationId && currentConversationId) {
      console.log('Starting new conversation');
      startNewConversation();
      hasLoadedConversation.current = undefined;
    }
  }, [selectedConversationId, currentConversationId, loadConversation, startNewConversation]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const handleSendMessage = async () => {
    if (message.trim() && !loading) {
      const messageToSend = message;
      setMessage(''); // Clear immediately for better UX
      
      await sendMessage(messageToSend, (newConversationId: string) => {
        if (onConversationCreated) {
          onConversationCreated(newConversationId);
          hasLoadedConversation.current = newConversationId;
        }
      });
    }
  };

  // Clear error when user starts typing
  useEffect(() => {
    if (error && message) {
      clearError();
    }
  }, [message, error, clearError]);

  // Group messages: user message followed by all AI responses to that message
  const groupedMessages: Array<{ userMessage: Message; aiResponses: Message[] }> = [];
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    if (msg.role === 'user') {
      const aiResponses: Message[] = [];
      
      // Collect all AI responses following this user message
      for (let j = i + 1; j < messages.length && messages[j].role === 'assistant'; j++) {
        aiResponses.push(messages[j]);
      }
      
      groupedMessages.push({
        userMessage: msg,
        aiResponses,
      });
      
      // Skip the AI messages we just collected
      i += aiResponses.length;
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#201d26]">
      {error && (
        <div className="flex-shrink-0 bg-red-500/10 border-b border-red-500/20 px-6 py-3">
          <div className="flex items-center space-x-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
            <button
              onClick={clearError}
              className="ml-auto text-red-400 hover:text-red-300 text-sm underline transition-colors duration-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {isFirstMessage ? (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="text-center max-w-2xl w-full">
            <div className="mb-4">
              <Link href="/" className="inline-block">
                <Image
                  src="/logo.png"
                  alt="ChatterStack Logo"
                  width={150}
                  height={150}
                  priority
                  className="mx-auto object-contain pointer-events-none"
                />
              </Link>
              <p className="text-gray-300 text-lg mt-6 font-medium">
                How can I help you today?
              </p>
            </div>

            <MessageInput
              message={message}
              onMessageChange={setMessage}
              onSendMessage={handleSendMessage}
              loading={loading}
            />

            <div className="flex items-center justify-center mt-4 text-xs text-gray-500">
              <span>ChatterStack can make mistakes. Check important info.</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Messages Container - Scrollable */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
              {groupedMessages.map((group, groupIndex) => (
                <div key={`group-${groupIndex}`} className="space-y-6">
                  {/* User Message */}
                  <div className="flex justify-end">
                    <UserMessage content={group.userMessage.content} />
                  </div>

                  {/* AI Responses - Grid Layout */}
                  {group.aiResponses.length > 0 && (
                    <div className={`grid gap-4 ${
                      viewMode === 'all' && group.aiResponses.length > 1
                        ? group.aiResponses.length === 2
                          ? 'grid-cols-1 md:grid-cols-2'
                          : group.aiResponses.length === 3
                          ? 'grid-cols-1 md:grid-cols-3'
                          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
                        : 'grid-cols-1'
                    }`}>
                      {activeModels.map((modelId) => {
                        const aiMessage = group.aiResponses.find(
                          (resp) => resp.modelId === modelId
                        );

                        if (!aiMessage) return null;

                        return (
                          <div key={modelId} className="w-full">
                            {/* Model Header */}
                            <div className="flex items-center gap-2 mb-3 px-2">
                              <Image
                                src={modelIconMap[modelId]}
                                alt={`${modelNameMap[modelId]} logo`}
                                width={16}
                                height={16}
                                className={`${modelId === 'openai/gpt-4o' ? 'invert brightness-0' : ''}`}
                              />
                              <span className="text-xs font-medium text-gray-400">
                                {modelNameMap[modelId]}
                              </span>
                            </div>
                            
                            {/* AI Message */}
                            <AIMessageWithActions
                              content={aiMessage.content}
                              modelId={aiMessage.modelId}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              
              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Bar - Fixed at Bottom */}
          <div className="flex-shrink-0 border-t border-gray-700/50 bg-[#282230] backdrop-blur-sm">
            <div className="max-w-5xl mx-auto px-6 py-4">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                loading={loading}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatInterface;