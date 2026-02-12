import React, { useState, useEffect, useRef, memo } from 'react';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import MessageInput from '../ChatInterface/MessageInput';
import { ChatInterfaceProps } from '@/app/types';

import AIMessage from '../ChatInterface/AIMessage';
import UserMessage from '../ChatInterface/UserMessage';
import CouncilProgressIndicator from './ProgressIndicator';
import { useCouncilChat } from '@/app/hooks/useCoucilChat';


const CouncilChatInterface: React.FC<ChatInterfaceProps> = ({
  selectedConversationId,
  onConversationCreated,
}) => {
  const [message, setMessage] = useState('');
  
  const {
    messages,
    loading,
    error,
    councilProgress,
    sendMessage,
    startNewConversation,
    loadConversation,
    clearError,
    currentConversationId,
  } = useCouncilChat();

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastLoadedConversationRef = useRef<string | undefined>(undefined);
  const isLoadingConversationRef = useRef(false);

  const isFirstMessage = messages.length === 0;

  // Load conversation when selectedConversationId changes
  useEffect(() => {
    if (isLoadingConversationRef.current) {
      return;
    }

    if (selectedConversationId && selectedConversationId !== lastLoadedConversationRef.current) {
      console.log('Loading council conversation:', selectedConversationId);
      
      isLoadingConversationRef.current = true;
      lastLoadedConversationRef.current = selectedConversationId;
      
      loadConversation(selectedConversationId).finally(() => {
        isLoadingConversationRef.current = false;
      });
    } else if (!selectedConversationId && lastLoadedConversationRef.current) {
      console.log('Starting new council conversation');
      lastLoadedConversationRef.current = undefined;
      startNewConversation();
    }
  }, [selectedConversationId, currentConversationId, loadConversation, startNewConversation]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const handleSendMessage = async () => {
    if (message.trim() && !loading) {
      const messageToSend = message;
      setMessage('');
      
      await sendMessage(messageToSend, (newConversationId: string) => {
        if (onConversationCreated) {
          console.log('New council conversation created:', newConversationId);
          lastLoadedConversationRef.current = newConversationId;
          onConversationCreated(newConversationId);
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
      {error && (
        <div className="flex-shrink-0 bg-red-500/10 border-b border-red-500/20">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
              <button
                onClick={clearError}
                className="ml-auto text-red-400 hover:text-red-300 text-sm underline transition-colors duration-200 cursor-pointer"
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
              <Link href="/" className="inline-block cursor-pointer">
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
                AI Council Mode
              </h1>
              <p className="text-gray-400 text-base mb-4">
                Powered by multiple expert AI models working together
              </p>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6">
                <p className="text-yellow-300 text-sm">
                  ⚡ Council mode uses 4 advanced AI models to analyze, debate, and synthesize the best possible answer to your question.
                </p>
              </div>
            </div>

            <div className="max-w-2xl mx-auto">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                loading={loading}
                placeholder="Ask the AI council a question..."
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Messages Container - Scrollable */}
          <div 
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto"
            style={{ willChange: 'scroll-position' }}
          >
            <div className="py-6 space-y-6">
              {messages.map((msg, index) => {
                const isLastMessage = index === messages.length - 1;
                
                if (msg.role === 'user') {
                  return <MemoizedUserMessage key={`user-${index}-${msg.createdAt}`} content={msg.content} />;
                } else {
                  return (
                    <MemoizedAIMessage
                      key={`ai-${index}-${msg.createdAt}`}
                      content={msg.content}
                      modelId={msg.modelId}
                      loading={loading && isLastMessage}
                      isLastMessage={isLastMessage}
                    />
                  );
                }
              })}

              {/* Show council progress indicator */}
              {loading && councilProgress.length > 0 && (
                <CouncilProgressIndicator
                  progress={councilProgress}
                  isActive={loading}
                />
              )}
              
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
                placeholder="Ask the AI council..."
              />
              <div className="flex items-center justify-center mt-2 text-xs text-gray-500">
                <span>Council mode synthesizes insights from 4 expert AI models</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Memoized components
const MemoizedUserMessage = memo(UserMessage, (prev, next) => {
  return prev.content === next.content;
});

const MemoizedAIMessage = memo(AIMessage, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.modelId === next.modelId &&
    prev.loading === next.loading &&
    prev.isLastMessage === next.isLastMessage
  );
});

MemoizedUserMessage.displayName = 'MemoizedUserMessage';
MemoizedAIMessage.displayName = 'MemoizedAIMessage';

export default memo(CouncilChatInterface);