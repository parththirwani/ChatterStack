import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { AlertCircle, ArrowDown, Code2, GitCompareArrows, Mail, Menu, Plus } from 'lucide-react';
import MessageInput from '../input/MessageInput';
import UserMessage from '../messages/UserMessage/UserMessage';
import CouncilProgressIndicator from '../../council/progress/ProgressIndicator';
import { useChatOptimized } from '@/src/hooks/useChat';
import { ChatInterfaceProps } from '@/src/types/chat.types';
import AIMessage from '../messages/AIMessage/AIMessage';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import { useAppStore } from '@/src/store/rootStore';
import LoginModal from '@/src/components/auth/AuthModal';
import { User } from '@/src/types/user.types';


const ChatInterface: React.FC<ChatInterfaceProps> = ({
  selectedConversationId,
  onConversationCreated,
  mobileMenuOpen = false,
}) => {
  const [message, setMessage] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const { selectedModel } = useModelSelection();
  const initializeUser = useAppStore((state) => state.initializeUser);
  const conversationTitle = useAppStore((state) => state.conversations.find((conversation) => conversation.id === selectedConversationId)?.title);
  
  const {
    messages,
    loading,
    error,
    councilProgress,
    sendMessage,
    startNewConversation,
    loadConversation,
    clearError,
    stopGenerating,
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
  const displayTitle = conversationTitle || messages.find((item) => item.role === 'user')?.content || 'Conversation';
  const isCouncilMode = selectedModel === 'council';
  const showCouncilProgress = loading && isCouncilMode && councilProgress.length > 0;

  useEffect(() => {
    if (isLoadingConversationRef.current) return;

    if (selectedConversationId && selectedConversationId !== lastLoadedConversationRef.current) {
      isLoadingConversationRef.current = true;
      lastLoadedConversationRef.current = selectedConversationId;
      
      autoScrollEnabledRef.current = false;
      userHasScrolledRef.current = true;
      
      loadConversation(selectedConversationId).finally(() => {
        isLoadingConversationRef.current = false;
        // Land at the bottom of the loaded conversation once, then re-enable autoscroll
        requestAnimationFrame(() => {
          const container = messagesContainerRef.current;
          if (container) {
            container.scrollTop = container.scrollHeight;
          }
          autoScrollEnabledRef.current = true;
          userHasScrolledRef.current = false;
        });
      });
    } else if (!selectedConversationId && lastLoadedConversationRef.current) {
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
      setShowJumpToLatest(true);
    } else if (distanceFromBottom < 10) {
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;
      setShowJumpToLatest(false);
    }
  }, []);

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
    if (!message.trim() || loading) return;

    // Re-read auth state fresh: the render-time `user` can be stale right
    // after an OAuth redirect, which previously re-opened the login modal
    // even though the user was already authenticated.
    const freshUser = useAppStore.getState().user;
    const authenticated = freshUser && freshUser.id && freshUser.id !== 'guest';

    // Check if user is authenticated - if not, show modal
    if (!authenticated) {
      const text = message.trim();
      setPendingMessage(text);
      // Persist across the full-page OAuth redirect (React state is wiped).
      try {
        sessionStorage.setItem('pendingChatMessage', text);
      } catch {
        // storage unavailable - pending message only lives in memory
      }
      setShowLoginModal(true);
      return;
    }

    const messageToSend = message;
    setMessage('');
    
    autoScrollEnabledRef.current = true;
    userHasScrolledRef.current = false;

    await sendMessage(messageToSend, (newConversationId: string) => {
      if (onConversationCreated && !currentConversationId) {
        lastLoadedConversationRef.current = newConversationId;
        onConversationCreated(newConversationId);
      }
    });
  }, [message, loading, sendMessage, onConversationCreated, currentConversationId]);

  // Restore a pending message that was saved before the full-page OAuth
  // redirect. After returning to `/?auth=success` React state is empty, so
  // the message would otherwise be lost and the user asked to log in again.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem('pendingChatMessage');
    } catch {
      stored = null;
    }
    if (stored) {
      setPendingMessage(stored);
      setMessage(stored);
      try {
        sessionStorage.removeItem('pendingChatMessage');
      } catch {
        // ignore
      }
    }
  }, []);

  const handleLoginSuccess = useCallback(async (authenticatedUser: User | null) => {
    setShowLoginModal(false);

    // Ensure the store has the fresh user (the modal may have fired before
    // ChatPage's own initialization ran).
    let freshUser = useAppStore.getState().user;
    if (!freshUser || !freshUser.id || freshUser.id === 'guest') {
      try {
        await initializeUser();
      } catch {
        // initializeUser already handles errors internally
      }
      freshUser = useAppStore.getState().user;
    }
    const effectiveUser = freshUser ?? authenticatedUser;
    const isValid = effectiveUser && effectiveUser.id && effectiveUser.id !== 'guest';

    // Fall back to the message saved before the OAuth redirect.
    let textToSend = pendingMessage;
    if (!textToSend) {
      try {
        textToSend = sessionStorage.getItem('pendingChatMessage') || '';
      } catch {
        textToSend = '';
      }
    }

    if (textToSend && isValid) {
      try {
        sessionStorage.removeItem('pendingChatMessage');
      } catch {
        // ignore
      }
      autoScrollEnabledRef.current = true;
      userHasScrolledRef.current = false;

      await sendMessage(textToSend, (newConversationId: string) => {
        if (onConversationCreated && !currentConversationId) {
          lastLoadedConversationRef.current = newConversationId;
          onConversationCreated(newConversationId);
        }
      });

      setPendingMessage('');
      setMessage('');
    }
  }, [pendingMessage, sendMessage, onConversationCreated, currentConversationId, initializeUser]);

  const handleLoginModalClose = useCallback(() => {
    setShowLoginModal(false);
    const storedFallback = (() => {
      try {
        return sessionStorage.getItem('pendingChatMessage');
      } catch {
        return null;
      }
    })();
    const restore = pendingMessage || storedFallback;
    if (restore) {
      setMessage(restore);
      setPendingMessage('');
      try {
        sessionStorage.removeItem('pendingChatMessage');
      } catch {
        // ignore
      }
    }
  }, [pendingMessage]);

  useEffect(() => {
    if (error && message) {
      clearError();
    }
  }, [message, error, clearError]);

  return (
    <div className={`relative flex h-full min-h-0 flex-col bg-[#191919] text-[#efeeec] ${isFirstMessage ? 'chat-empty-shell justify-center' : ''}`}>
      <header className={`z-20 flex h-14 shrink-0 items-center justify-between px-4 md:px-6 ${isFirstMessage ? 'absolute inset-x-0 top-0' : ''}`}>
        <div className="flex items-center gap-3">
          <button id="chat-sidebar-toggle" type="button" onClick={() => window.dispatchEvent(new Event('chatterstack:toggle-sidebar'))} aria-label="Toggle sidebar" aria-controls="chat-sidebar" aria-expanded={mobileMenuOpen} className="flex h-11 w-11 items-center justify-center rounded-lg text-[#aaa7a3] hover:bg-white/5 hover:text-white md:hidden"><Menu className="h-5 w-5" /></button>
          <span className="max-w-[55vw] truncate text-sm font-medium text-[#c9c7c4]">{isFirstMessage ? 'New chat' : displayTitle}</span>
        </div>
        {!isFirstMessage && <button type="button" onClick={() => window.dispatchEvent(new Event('chatterstack:new-chat'))} aria-label="New chat" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#aaa7a3] hover:bg-white/5 hover:text-white"><Plus className="h-4 w-4" /></button>}
      </header>

      {error && (
        <div role="alert" className="mx-auto flex w-full max-w-[760px] items-center gap-2 px-5 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="rounded-md px-2 py-1 hover:bg-white/5">Dismiss</button>
        </div>
      )}

      <div ref={messagesContainerRef} onScroll={handleScroll} className={`relative z-10 min-h-0 overflow-y-auto overscroll-contain ${isFirstMessage ? 'shrink-0' : 'flex-1'}`}>
        {isFirstMessage ? (
          <div className="flex flex-col items-center justify-center px-5 pb-3 text-center">
            <h1 className="max-w-[620px] font-serif text-[30px] font-normal leading-[1.18] tracking-[-0.025em] text-[#f1efec] sm:text-[44px]">
              {isCouncilMode ? 'Bring the council together' : 'What can I help you work on?'}
            </h1>
            <p className="chat-empty-subtitle mt-3 max-w-[520px] text-sm leading-6 text-[#a7a39e] sm:text-[15px]">
              {isCouncilMode ? 'Up to four models examine your question and combine their findings.' : 'Ask a question, work through an idea, or start with a task below.'}
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[800px] space-y-5 px-4 pb-8 pt-5 sm:px-6">
            {messages.map((msg, index) => {
              const isLastMessage = index === messages.length - 1;
              if (msg.role === 'user') return <MemoizedUserMessage key={`user-${index}-${msg.createdAt}`} content={msg.content} />;
              return <MemoizedAIMessage key={`ai-${index}-${msg.createdAt}`} content={msg.content} modelId={msg.modelId} loading={loading && isLastMessage} isLastMessage={isLastMessage} />;
            })}
            {showCouncilProgress && <CouncilProgressIndicator progress={councilProgress} isActive={true} />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="relative z-20 shrink-0 bg-gradient-to-t from-[#191919] via-[#191919] to-[#191919]/90 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {showJumpToLatest && !isFirstMessage && <button type="button" onClick={() => { const el = messagesContainerRef.current; if (el) el.scrollTop = el.scrollHeight; autoScrollEnabledRef.current = true; userHasScrolledRef.current = false; setShowJumpToLatest(false); }} className="mx-auto mb-3 flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-[#292929] px-4 text-xs text-white shadow-lg"><ArrowDown className="h-3.5 w-3.5" /> Jump to latest</button>}
        <div className="mx-auto max-w-[720px]">
          <MessageInput message={message} onMessageChange={setMessage} onSendMessage={handleSendMessage} onStopGenerating={stopGenerating} loading={loading} placeholder={isCouncilMode ? 'Ask the council anything' : 'Ask anything'} />
          {isFirstMessage && !isCouncilMode && <div className="mx-auto mt-4 grid w-full max-w-[620px] grid-cols-2 gap-2 text-left">
            {[
              { label: 'Explain code', prompt: 'Explain this code: ', Icon: Code2 },
              { label: 'Draft an email', prompt: 'Help me draft an email about ', Icon: Mail },
              { label: 'Compare ideas', prompt: 'Compare these ideas: ', Icon: GitCompareArrows },
              { label: 'Plan a project', prompt: 'Help me plan a project for ', Icon: Plus },
            ].map(({ label, prompt, Icon }) => <button key={label} type="button" onClick={() => { setMessage((current) => current || prompt); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus(), 0); }} className="flex min-h-12 items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.025] px-3 text-[13px] text-[#c9c5c0] transition-colors hover:border-white/20 hover:bg-white/[0.055] hover:text-white max-[340px]:gap-1.5 max-[340px]:px-2 sm:gap-3 sm:px-4 sm:text-sm"><Icon className="h-4 w-4 shrink-0 text-[#e8b775]" />{label}</button>)}
          </div>}
          <p className="mt-3 text-center text-xs leading-5 text-[#aaa6a2]">ChatterStack can make mistakes. Check important information.</p>
        </div>
      </div>

      <LoginModal isOpen={showLoginModal} onClose={handleLoginModalClose} onLoginSuccess={handleLoginSuccess} message="Sign in to start chatting" />
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
