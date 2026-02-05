import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import MessageInput from './MessageInput';

import { ChatInterfaceProps, Message } from '@/app/types';
import { useChat } from '@/app/hooks/useChat';
import AIMessage from './AIMessage';
import UserMessage from './UserMessage';
import ModelSelector from './ModelSelector';

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  selectedConversationId,
  onConversationCreated,
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

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedConversation = useRef<string | undefined>(undefined);

  const isFirstMessage = messages.length === 0;

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
      setMessage('');
      
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

  return (
    <div className="h-full flex flex-col bg-[#201d26]">
      {/* Header with Model Selector */}
      <div className="flex-shrink-0 border-b border-gray-700/50 bg-[#282230] backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="ChatterStack Logo"
              width={24}
              height={24}
              className="opacity-80"
            />
            <span className="text-sm text-gray-400 font-medium">ChatterStack</span>
          </div>
          <ModelSelector />
        </div>
      </div>

      {error && (
        <div className="flex-shrink-0 bg-red-500/10 border-b border-red-500/20">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-red-400">
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
        </div>
      )}

      {isFirstMessage ? (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="text-center max-w-2xl w-full">
            <div className="mb-8">
              <Link href="/" className="inline-block">
                <Image
                  src="/logo.png"
                  alt="ChatterStack Logo"
                  width={120}
                  height={120}
                  priority
                  className="mx-auto object-contain pointer-events-none opacity-90"
                />
              </Link>
              <h1 className="text-2xl font-bold text-white mt-6 mb-2">
                Welcome to <span className="text-yellow-500">ChatterStack</span>
              </h1>
              <p className="text-gray-400 text-base">
                Your AI assistant powered by multiple language models
              </p>
            </div>

            <div className="max-w-2xl mx-auto">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                loading={loading}
              />
            </div>

            <div className="flex items-center justify-center mt-4 text-xs text-gray-500">
              <span>Select a model and start chatting</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Messages Container - Scrollable */}
          <div className="flex-1 overflow-y-auto">
            <div className="py-6 space-y-6">
              {messages.map((msg, index) => {
                const isLastMessage = index === messages.length - 1;
                
                if (msg.role === 'user') {
                  return <UserMessage key={index} content={msg.content} />;
                } else {
                  return (
                    <AIMessage
                      key={index}
                      content={msg.content}
                      modelId={msg.modelId}
                      loading={loading && isLastMessage}
                      isLastMessage={isLastMessage}
                    />
                  );
                }
              })}
              
              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Bar - Fixed at Bottom */}
          <div className="flex-shrink-0 border-t border-gray-700/50 bg-[#282230] backdrop-blur-sm">
            <div className="max-w-3xl mx-auto px-4 py-4">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                loading={loading}
              />
              <div className="flex items-center justify-center mt-2 text-xs text-gray-500">
                <span>ChatterStack can make mistakes. Check important info.</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatInterface;