import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import MessageInput from './MessageInput';

import { ChatInterfaceProps, Message } from '@/app/types';
import { useChat } from '@/app/hooks/useChat';
import AIMessageWithActions from './AIMessage';
import UserMessage from './UserMessage';

interface ChatInterfaceExtendedProps extends ChatInterfaceProps {
  viewMode: 'all' | string;
}

const SUPPORTED_MODELS = [
  'deepseek/deepseek-chat-v3.1',
  'google/gemini-2.5-flash',
  'openai/gpt-4o',
];

const modelNameMap: Record<string, string> = {
  'deepseek/deepseek-chat-v3.1': 'DeepSeek v3.1',
  'google/gemini-2.5-flash': 'Gemini Flash',
  'openai/gpt-4o': 'GPT-4o',
};

const modelIconMap: Record<string, string> = {
  'deepseek/deepseek-chat-v3.1': '/deepseek.svg',
  'google/gemini-2.5-flash': '/gemini.svg',
  'openai/gpt-4o': '/openai.svg',
};

const ChatInterface: React.FC<ChatInterfaceExtendedProps> = ({
  user,
  selectedConversationId,
  onConversationCreated,
  onNewChatStarted,
  viewMode,
}) => {
  const [message, setMessage] = useState('');
  
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

  const messagesEndRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isFirstMessage = messages.length === 0;

  useEffect(() => {
    if (selectedConversationId && selectedConversationId !== currentConversationId) {
      loadConversation(selectedConversationId);
    } else if (!selectedConversationId && currentConversationId) {
      startNewConversation();
    }
  }, [selectedConversationId, currentConversationId, loadConversation, startNewConversation]);

  useEffect(() => {
    const modelsToUpdate = viewMode === 'all' ? SUPPORTED_MODELS : [viewMode];
    
    modelsToUpdate.forEach((modelId) => {
      setTimeout(() => {
        const endElement = messagesEndRefs.current[modelId];
        if (endElement) {
          endElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }, 100);
    });
  }, [messages, loading, viewMode]);

  const handleSendMessage = async () => {
    if (message.trim() && !loading) {
      await sendMessage(message, (newConversationId: string) => {
        if (onConversationCreated) {
          onConversationCreated(newConversationId);
        }
      });
      setMessage('');
    }
  };

  const handleNewChat = () => {
    startNewConversation();
    if (onNewChatStarted) {
      onNewChatStarted();
    }
  };

  useEffect(() => {
    if (error && message) {
      clearError();
    }
  }, [message, error, clearError]);

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
          <div className="flex-1 flex overflow-y-auto p-6 gap-4 min-h-0">
            {(viewMode === 'all' ? SUPPORTED_MODELS : [viewMode]).map((modelId) => (
              <div key={modelId} className={`${viewMode === 'all' ? 'flex-1 min-w-0' : 'w-full'} flex flex-col h-full`}>
                <div
                  className="flex-1 overflow-y-auto px-4 bg-[#2a2633]/50 rounded-lg shadow-md border border-gray-700/30"
                  ref={(el) => { scrollContainerRefs.current[modelId] = el; }}
                >
                  <div className="flex items-center justify-center gap-2 py-3 border-b border-gray-700/50 sticky top-0 bg-[#2a2633]/80 backdrop-blur-sm z-10">
                    <Image
                      src={modelIconMap[modelId]}
                      alt={`${modelNameMap[modelId]} logo`}
                      width={20}
                      height={20}
                      className={`${modelId === 'openai/gpt-4o' ? 'invert brightness-0' : ''}`}
                    />
                    <span className="text-sm font-medium text-gray-200">{modelNameMap[modelId]}</span>
                  </div>

                  <div className="space-y-6 py-4">
                    {messages.map((msg: Message, index: number) => {
                      if (msg.role === 'user') {
                        return (
                          <div key={`user-${index}`} className="flex justify-end">
                            <UserMessage content={msg.content} />
                          </div>
                        );
                      }
                      if (msg.role === 'assistant' && msg.modelId === modelId) {
                        return (
                          <AIMessageWithActions
                            key={`ai-${index}`}
                            content={msg.content}
                            modelId={msg.modelId}
                          />
                        );
                      }
                      return null;
                    })}
                    <div ref={(el) => { messagesEndRefs.current[modelId] = el; }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex-shrink-0 p-4 border-t border-gray-700/50 bg-[#2a2633]/80 backdrop-blur-sm">
            <div className="max-w-4xl mx-auto">
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
