import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import MessageInput from '../input/MessageInput';
import UserMessage from '../messages/UserMessage/UserMessage';
import CouncilProgressIndicator from '../../council/progress/ProgressIndicator';
import { useChatOptimized } from '@/src/hooks/useChat';
import { ChatInterfaceProps } from '@/src/types/chat.types';
import AIMessage from '../messages/AIMessage/AIMessage';
import QuickToolButton from './QuickToolButton';


const ChatInterface: React.FC<ChatInterfaceProps> = ({
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
  const previousMessagesLengthRef = useRef(0);

  const isFirstMessage = messages.length === 0;

  useEffect(() => {
    if (isLoadingConversationRef.current) {
      return;
    }

    if (selectedConversationId && selectedConversationId !== lastLoadedConversationRef.current) {
      console.log('Loading conversation:', selectedConversationId);
      
      isLoadingConversationRef.current = true;
      lastLoadedConversationRef.current = selectedConversationId;
      
      autoScrollEnabledRef.current = false;
      userHasScrolledRef.current = true;
      
      loadConversation(selectedConversationId).finally(() => {
        isLoadingConversationRef.current = false;
      });
    } else if (!selectedConversationId && lastLoadedConversationRef.current) {
      console.log('Starting new conversation');
      lastLoadedConversationRef.current = undefined;
      startNewConversation();
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;
    }
  }, [selectedConversationId, loadConversation, startNewConversation]);

  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    if (distanceFromBottom > 100) {
      autoScrollEnabledRef.current = false;
      userHasScrolledRef.current = true;
    } else if (distanceFromBottom < 10) {
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;
    }
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  const smoothScrollToBottom = useCallback(() => {
    if (!messagesContainerRef.current || !autoScrollEnabledRef.current) return;

    const container = messagesContainerRef.current;
    const targetScrollTop = container.scrollHeight - container.clientHeight;
    const currentScrollTop = container.scrollTop;
    const distance = targetScrollTop - currentScrollTop;

    if (Math.abs(distance) < 1) {
      container.scrollTop = targetScrollTop;
      return;
    }

    const easeAmount = 0.15;
    const delta = distance * easeAmount;

    container.scrollTop = currentScrollTop + delta;

    if (Math.abs(distance) > 1) {
      scrollAnimationFrameRef.current = requestAnimationFrame(smoothScrollToBottom);
    }
  }, []);

  useEffect(() => {
    if (scrollAnimationFrameRef.current) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
    }

    const lastMessage = messages[messages.length - 1];
    const currentContentLength = lastMessage?.content?.length || 0;
    
    const isGenerating = loading && messages.length > 0 && currentContentLength > lastContentLengthRef.current;
    
    if (isGenerating && autoScrollEnabledRef.current) {
      smoothScrollToBottom();
    }
    
    lastMessageCountRef.current = messages.length;
    lastContentLengthRef.current = currentContentLength;

    return () => {
      if (scrollAnimationFrameRef.current) {
        cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
    };
  }, [messages, loading, smoothScrollToBottom]);

  useEffect(() => {
    if (loading && messages.length > previousMessagesLengthRef.current) {
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;
    }
    
    previousMessagesLengthRef.current = messages.length;
  }, [loading, messages.length]);

  const handleSendMessage = useCallback(async () => {
    if (message.trim() && !loading) {
      const messageToSend = message;
      setMessage('');
      
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

  useEffect(() => {
    if (error && message) {
      clearError();
    }
  }, [message, error, clearError]);

  return (
    <div className="h-full flex flex-col bg-[#201d26] relative">
      {/* Subtle grid background */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />

      {error && (
        <div className="flex-shrink-0 bg-red-500/10 border-b border-red-500/20 relative z-10">
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
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto relative z-10">
          <div className="text-center max-w-4xl w-full">
            {/* Welcome Section */}
            <div className="mb-12 animate-in fade-in duration-700">
              <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 tracking-tight leading-tight">
                What's on your mind today?
              </h1>
              <p className="text-lg text-gray-400">
                Ask anything, explore ideas, or get help with your work
              </p>
            </div>

            {/* Input Section */}
            <div className="max-w-3xl mx-auto mb-8">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                loading={loading}
                placeholder="Message AI chat..."
              />
            </div>

            {/* Quick Tools */}
            <div className="flex flex-wrap gap-3 justify-center max-w-4xl mx-auto mb-8">
              <QuickToolButton icon="✍️" label="AI script writer" onClick={() => setMessage("Help me write a script for ")} />
              <QuickToolButton icon="💻" label="Coding Assistant" onClick={() => setMessage("Help me with coding: ")} />
              <QuickToolButton icon="📝" label="Essay writer" onClick={() => setMessage("Help me write an essay about ")} />
              <QuickToolButton icon="💼" label="Business" onClick={() => setMessage("Help me with business advice on ")} />
              <QuickToolButton icon="🌐" label="Translate" onClick={() => setMessage("Translate this text: ")} />
              <QuickToolButton icon="🎥" label="YouTube summaries" onClick={() => setMessage("Summarize this YouTube video: ")} />
              <QuickToolButton icon="✉️" label="AI Email writing" onClick={() => setMessage("Help me write an email about ")} />
              <QuickToolButton icon="📄" label="AI PDF chat" onClick={() => setMessage("Help me analyze this PDF: ")} />
              <QuickToolButton icon="🔍" label="Research assistant" onClick={() => setMessage("Research this topic: ")} />
            </div>

            <div className="text-xs text-gray-500">
              Powered by advanced AI models • ChatterStack can make mistakes
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Messages Container - Scrollable */}
          <div 
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto relative z-10"
            style={{ 
              willChange: 'scroll-position',
              scrollBehavior: 'auto'
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

              {loading && councilProgress.length > 0 && (
                <CouncilProgressIndicator
                  progress={councilProgress}
                  isActive={loading}
                  hideWhenGenerating={true}
                  hasStartedGenerating={messages.length > 0 && messages[messages.length - 1].content.length > 0}
                />
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Bar - Fixed at Bottom */}
          <div className="flex-shrink-0 border-t border-gray-700/50 bg-[#282230] backdrop-blur-sm relative z-10">
            <div className="max-w-3xl mx-auto px-4 py-4">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                loading={loading}
                placeholder="Message AI chat..."
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