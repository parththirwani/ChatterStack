import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import UserMessage from '../../chat/messages/UserMessage/UserMessage';
import CouncilProgressIndicator from '../progress/ProgressIndicator';
import { useCouncilChat } from '@/src/hooks/useCoucilChat';
import MessageInput from '../../chat/input/MessageInput';
import AIMessage from '../../chat/messages/AIMessage/AIMessage';
import { ChatInterfaceProps } from '@/src/types/chat.types';
import LoginModal from '@/src/components/auth/AuthModal';
import { useAppStore } from '@/src/store/rootStore';
import { User } from '@/src/types/user.types';


const CouncilChatInterface: React.FC<ChatInterfaceProps> = ({
  selectedConversationId,
  onConversationCreated,
}) => {
  const [message, setMessage] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  
  const user = useAppStore((state) => state.user);
  const isAuthenticated = user && user.id && user.id !== 'guest';
  
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
    if (!message.trim() || loading) return;

    // Check if user is authenticated
    if (!isAuthenticated) {
      setPendingMessage(message.trim());
      setShowLoginModal(true);
      return;
    }

    const messageToSend = message;
    setMessage('');
    
    await sendMessage(messageToSend, (newConversationId: string) => {
      if (onConversationCreated) {
        console.log('New council conversation created:', newConversationId);
        lastLoadedConversationRef.current = newConversationId;
        onConversationCreated(newConversationId);
      }
    });
  };

  const handleLoginSuccess = useCallback(async (authenticatedUser: User | null) => {
    setShowLoginModal(false);
    
    // Process pending message after successful login
    if (pendingMessage && authenticatedUser) {
      await sendMessage(pendingMessage, (newConversationId: string) => {
        if (onConversationCreated) {
          console.log('New council conversation created after login:', newConversationId);
          lastLoadedConversationRef.current = newConversationId;
          onConversationCreated(newConversationId);
        }
      });
      
      setPendingMessage('');
      setMessage('');
    }
  }, [pendingMessage, sendMessage, onConversationCreated]);

  const handleLoginModalClose = useCallback(() => {
    setShowLoginModal(false);
    // Keep the message in the input if user closes modal without logging in
    if (pendingMessage) {
      setMessage(pendingMessage);
      setPendingMessage('');
    }
  }, [pendingMessage]);

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
          <div className="text-center max-w-3xl w-full">
            {/* Logo and Title */}
            <div className="mb-8">
              <Link href="/" className="inline-block cursor-pointer">
                <Image
                  src="/logo.png"
                  alt="ChatterStack Logo"
                  width={80}
                  height={80}
                  priority
                  className="mx-auto object-contain pointer-events-none opacity-90"
                />
              </Link>
              <h1 className="text-3xl md:text-4xl font-bold text-white mt-6 mb-3">
                AI Council Mode
              </h1>
              <p className="text-gray-400 text-base md:text-lg max-w-2xl mx-auto">
                Harness the collective intelligence of four leading AI models working in concert
              </p>
            </div>

            {/* Professional Council Info Card */}
            <div className="bg-gradient-to-br from-yellow-500/10 via-yellow-500/5 to-transparent border border-yellow-500/20 rounded-2xl p-6 md:p-8 mb-8 backdrop-blur-sm">
              <div className="flex items-center justify-center gap-2 mb-4">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-yellow-400 text-xs font-medium uppercase tracking-wider">
                  Multi-Model Synthesis
                </span>
              </div>
              
              <p className="text-gray-300 text-sm md:text-base mb-6 leading-relaxed">
                Council mode orchestrates four expert AI models to analyze your question from multiple perspectives, 
                cross-validate insights, and synthesize a comprehensive answer.
              </p>

              {/* Model Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-3 hover:border-yellow-500/30 transition-colors">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">G5</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center font-medium">GPT-5.1</p>
                  <p className="text-xs text-gray-500 text-center mt-0.5">OpenAI</p>
                </div>

                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-3 hover:border-yellow-500/30 transition-colors">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">G3</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center font-medium">Gemini 3 Pro</p>
                  <p className="text-xs text-gray-500 text-center mt-0.5">Google</p>
                </div>

                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-3 hover:border-yellow-500/30 transition-colors">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">C4</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center font-medium">Claude 4.5</p>
                  <p className="text-xs text-gray-500 text-center mt-0.5">Anthropic</p>
                </div>

                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-3 hover:border-yellow-500/30 transition-colors">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">X4</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center font-medium">Grok 4</p>
                  <p className="text-xs text-gray-500 text-center mt-0.5">xAI</p>
                </div>
              </div>

              {/* Process Steps */}
              <div className="flex items-center justify-center gap-2 md:gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/50" />
                  <span>Analysis</span>
                </div>
                <div className="w-1 h-1 rounded-full bg-gray-600" />
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/50" />
                  <span>Review</span>
                </div>
                <div className="w-1 h-1 rounded-full bg-gray-600" />
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/50" />
                  <span>Synthesis</span>
                </div>
              </div>
            </div>

            {/* Input */}
            <div className="max-w-2xl mx-auto">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                loading={loading}
                placeholder="Ask the AI council a question..."
              />
            </div>

            {/* Subtle footer note */}
            <p className="text-xs text-gray-600 mt-6">
              Best for complex questions requiring multi-perspective analysis
            </p>
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

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={handleLoginModalClose}
        onLoginSuccess={handleLoginSuccess}
        message="Sign in to use Council Mode"
      />
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