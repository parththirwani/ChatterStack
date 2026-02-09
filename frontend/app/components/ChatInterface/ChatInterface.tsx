import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import MessageInput from './MessageInput';

import { ChatInterfaceProps } from '@/app/types';

import AIMessage from './AIMessage';
import UserMessage from './UserMessage';
import CouncilProgressIndicator from '../Council/ProgressIndicator';
import { useChatOptimized } from '@/app/hooks/useChat';

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  selectedConversationId,
  onConversationCreated,
}) => {
  const [message, setMessage] = useState('');
  
  // ✅ CHANGED: Using optimized hook that connects to Zustand store
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
  } = useChatOptimized();

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastLoadedConversationRef = useRef<string | undefined>(undefined);
  const isLoadingConversationRef = useRef(false);
  const autoScrollEnabledRef = useRef(true);
  const userHasScrolledRef = useRef(false);
  const lastMessageCountRef = useRef(0);
  const lastContentLengthRef = useRef(0);
  const scrollAnimationFrameRef = useRef<number | null>(null);

  const isFirstMessage = messages.length === 0;

  useEffect(() => {
    if (isLoadingConversationRef.current) {
      return;
    }

    if (selectedConversationId && selectedConversationId !== lastLoadedConversationRef.current) {
      console.log('Loading conversation:', selectedConversationId);
      
      isLoadingConversationRef.current = true;
      lastLoadedConversationRef.current = selectedConversationId;
      
      loadConversation(selectedConversationId).finally(() => {
        isLoadingConversationRef.current = false;
      });
    } else if (!selectedConversationId && lastLoadedConversationRef.current) {
      console.log('Starting new conversation');
      lastLoadedConversationRef.current = undefined;
      startNewConversation();
    }
  }, [selectedConversationId, loadConversation, startNewConversation]);

  // Detect user manual scroll
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // If user scrolls up more than 100px from bottom, disable auto-scroll
    if (distanceFromBottom > 100) {
      autoScrollEnabledRef.current = false;
      userHasScrolledRef.current = true;
    } else if (distanceFromBottom < 10) {
      // Re-enable if user scrolls back to near bottom
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;
    }
  }, []);

  // Attach scroll listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Smooth continuous auto-scroll using requestAnimationFrame
  const smoothScrollToBottom = useCallback(() => {
    if (!messagesContainerRef.current || !autoScrollEnabledRef.current) return;

    const container = messagesContainerRef.current;
    const targetScrollTop = container.scrollHeight - container.clientHeight;
    const currentScrollTop = container.scrollTop;
    const distance = targetScrollTop - currentScrollTop;

    // If we're close enough, just jump there
    if (Math.abs(distance) < 1) {
      container.scrollTop = targetScrollTop;
      return;
    }

    // Smooth easing function - adjust speed here (0.1 = slower, 0.3 = faster)
    const easeAmount = 0.15;
    const delta = distance * easeAmount;

    container.scrollTop = currentScrollTop + delta;

    // Continue scrolling if we haven't reached the bottom
    if (Math.abs(distance) > 1) {
      scrollAnimationFrameRef.current = requestAnimationFrame(smoothScrollToBottom);
    }
  }, []);

  // Trigger smooth scroll when messages update during generation
  useEffect(() => {
    // Cancel any existing animation frame
    if (scrollAnimationFrameRef.current) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
    }

    const lastMessage = messages[messages.length - 1];
    const currentContentLength = lastMessage?.content?.length || 0;
    
    // Check if we're actively generating (content is changing)
    const isGenerating = loading && messages.length > 0 && currentContentLength > lastContentLengthRef.current;
    const messageCountChanged = messages.length !== lastMessageCountRef.current;
    
    if ((isGenerating || messageCountChanged) && autoScrollEnabledRef.current) {
      // Start smooth scrolling
      smoothScrollToBottom();
    }
    
    lastMessageCountRef.current = messages.length;
    lastContentLengthRef.current = currentContentLength;

    // Cleanup animation frame on unmount
    return () => {
      if (scrollAnimationFrameRef.current) {
        cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
    };
  }, [messages, loading, smoothScrollToBottom]);

  // Re-enable auto-scroll when new message starts
  useEffect(() => {
    if (loading && messages.length > 0) {
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;
    }
  }, [loading, messages.length]);

  const handleSendMessage = useCallback(async () => {
    if (message.trim() && !loading) {
      const messageToSend = message;
      setMessage('');
      
      // Re-enable auto-scroll for new message
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;

      await sendMessage(messageToSend, (newConversationId: string) => {
        if (onConversationCreated && !currentConversationId) {
          console.log('New conversation created:', newConversationId);
          lastLoadedConversationRef.current = newConversationId;
          onConversationCreated(newConversationId);
        }
      });
    }
  }, [message, loading, sendMessage, onConversationCreated, currentConversationId]);

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
          <div 
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto"
            style={{ 
              willChange: 'scroll-position',
              scrollBehavior: 'auto' // Use auto for RAF control
            }}
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

              {/* Show council progress ONLY while waiting for response to start */}
              {loading && councilProgress.length > 0 && (
                <CouncilProgressIndicator
                  progress={councilProgress}
                  isActive={loading}
                  hideWhenGenerating={true}
                  hasStartedGenerating={messages.length > 0 && messages[messages.length - 1].content.length > 0}
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

// Memoized components to prevent unnecessary re-renders
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

export default memo(ChatInterface);