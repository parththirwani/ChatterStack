"use client";
import React, { useState, useEffect, useLayoutEffect, useRef, memo, useCallback, useMemo } from 'react';
import { AlertCircle, ArrowDown, Code2, GitCompareArrows, ListTodo, Mail, PanelLeft, Pencil, Plus } from 'lucide-react';
import MessageInput from '../input/MessageInput';
import UserMessage from '../messages/UserMessage/UserMessage';
import { useChat } from '@/src/hooks/useChat';
import { useComposerDraft } from '@/src/hooks/useComposerDraft';
import type { DocumentAttachment, ChatInterfaceProps, CouncilProgress, Message } from '@/src/types/chat.types';
import AIMessage from '../messages/AIMessage/AIMessage';
import TurnNavigator from '../navigation/TurnNavigator';
import { buildTurns } from '../navigation/turns';
import type { Turn } from '../navigation/turns';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import { useAppStore } from '@/src/store/rootStore';
import LoginModal from '@/src/components/auth/AuthModal';
import type { User } from '@/src/types/user.types';
import type { SkillTag } from '@/src/types/skill.types';
import { ADD_SKILL_EVENT } from '@/src/lib/client/skills';
import { MAX_SKILLS_PER_MESSAGE } from '@/src/lib/skills/skill-file';

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TURNS: Turn[] = [];

const starterPrompts = [
  { label: 'Explain code', prompt: 'Explain this code: ', Icon: Code2 },
  { label: 'Draft an email', prompt: 'Help me draft an email about ', Icon: Mail },
  { label: 'Compare ideas', prompt: 'Compare these ideas: ', Icon: GitCompareArrows },
  { label: 'Plan a project', prompt: 'Help me plan a project for ', Icon: ListTodo },
];

function dispatchNewChat() {
  window.dispatchEvent(new Event('chatterstack:new-chat'));
}

function dispatchToggleSidebar() {
  window.dispatchEvent(new Event('chatterstack:toggle-sidebar'));
}

const TITLE_MAX_LENGTH = 80;

interface ChatHeaderProps {
  title: string;
  isFirstMessage: boolean;
  mobileMenuOpen: boolean;
  sidebarCollapsed: boolean;
  /** Set when the chat can be renamed (it exists in the conversation list). */
  onRename?: (title: string) => void;
}

const ChatHeader = memo(function ChatHeader({
  title,
  isFirstMessage,
  mobileMenuOpen,
  sidebarCollapsed,
  onRename,
}: ChatHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  // Switching chats mid-edit drops the edit rather than renaming the new chat.
  useEffect(() => setEditing(false), [title]);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    setDraft(title);
    setEditing(true);
  };

  const finishEditing = (save: boolean) => {
    if (!editing) return;
    setEditing(false);
    const next = draft.trim().slice(0, TITLE_MAX_LENGTH);
    if (save && next && next !== title) onRename?.(next);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  return (
    <header className={`z-20 flex h-14 shrink-0 items-center justify-between px-4 lg:px-6 ${isFirstMessage ? 'absolute inset-x-0 top-0' : ''}`}>
      <div className="flex items-center gap-3">
        <button
          id="chat-sidebar-toggle"
          type="button"
          onClick={dispatchToggleSidebar}
          aria-label="Open navigation"
          aria-controls="chat-sidebar"
          aria-expanded={mobileMenuOpen}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-[#aaa7a3] transition-colors hover:bg-white/[0.07] hover:text-white lg:hidden"
        >
          <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </button>
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={dispatchToggleSidebar}
            aria-label="Open sidebar"
            aria-controls="chat-sidebar"
            aria-expanded="false"
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-[#aaa7a3] transition-colors hover:bg-white/[0.07] hover:text-white lg:flex"
          >
            <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        )}
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={TITLE_MAX_LENGTH}
            aria-label="Chat title"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finishEditing(true)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                finishEditing(true);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                finishEditing(false);
              }
            }}
            className="h-8 w-[min(55vw,420px)] rounded-md border border-white/[0.18] bg-[#1d1d1d] px-2 text-sm font-medium text-white outline-none focus:border-white/[0.38]"
          />
        ) : (
          <div className={`group flex min-w-0 items-center gap-1 ${isFirstMessage ? 'lg:hidden' : ''}`}>
            <span
              onDoubleClick={onRename && startEditing}
              className={`max-w-[55vw] truncate text-sm font-medium text-[#c9c7c4] ${onRename ? 'cursor-pointer select-none' : 'cursor-default'}`}
            >
              {title}
            </span>
            {onRename && (
              <button
                ref={editButtonRef}
                type="button"
                onClick={startEditing}
                aria-label="Rename chat"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#a9a5a0] transition-[opacity,color,background-color] hover:bg-white/[0.08] hover:text-white focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      {!isFirstMessage && (
        <button
          type="button"
          onClick={dispatchNewChat}
          aria-label="New chat"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-[#aaa7a3] transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </header>
  );
});

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  councilProgress: CouncilProgress[];
}

const MessageList = memo(function MessageList({
  messages,
  loading,
  councilProgress,
}: MessageListProps) {
  return (
    <div className="mx-auto w-full max-w-[768px] space-y-5 px-4 pb-8 pt-5 sm:px-6">
      {messages.map((msg, index) => {
        const isLastMessage = index === messages.length - 1;
        const key = msg.id ?? `${msg.role}-${index}-${msg.createdAt ?? ''}`;

        if (msg.role === 'user') {
          // Each question is an anchor the left rail jumps between.
          return (
            <div key={key} data-turn-anchor={index}>
              <UserMessage content={msg.content} attachments={msg.attachments} skills={msg.skills} />
            </div>
          );
        }

        return (
          <AIMessage
            key={key}
            content={msg.content}
            modelId={msg.modelId}
            loading={loading && isLastMessage}
            isLastMessage={isLastMessage}
            reasoning={msg.reasoning}
            reasoningStartedAt={msg.reasoningStartedAt}
            reasoningDurationMs={msg.reasoningDurationMs}
            council={msg.council}
            councilProgress={isLastMessage ? councilProgress : undefined}
          />
        );
      })}
    </div>
  );
});

const EmptyState = memo(function EmptyState({ isCouncilMode }: { isCouncilMode: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 pb-3 text-center">
      <h1 className="max-w-[620px] text-balance font-serif text-[30px] font-normal leading-[1.18] tracking-[-0.025em] text-[#f1efec] sm:text-[44px]">
        {isCouncilMode ? 'Bring the council together' : 'What can I help you work on?'}
      </h1>
      <p className="chat-empty-subtitle mt-3 max-w-[520px] text-sm leading-6 text-[#a7a39e] sm:text-[15px]">
        {isCouncilMode
          ? 'Up to four models examine your question and combine their findings.'
          : 'Ask a question, work through an idea, or start with a task below.'}
      </p>
    </div>
  );
});

const ConversationSkeleton = memo(function ConversationSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[768px] space-y-4 px-4 pb-8 pt-6 sm:px-6" aria-hidden="true">
      <div className="h-5 w-28 animate-pulse rounded bg-white/[0.05]" />
      <div className="ml-auto h-16 w-2/3 animate-pulse rounded-2xl bg-white/[0.04]" />
      <div className="h-4 w-24 animate-pulse rounded bg-white/[0.05]" />
      <div className="h-24 w-full animate-pulse rounded-xl bg-white/[0.035]" />
    </div>
  );
});

interface ChatComposerProps {
  conversationKey: string;
  loading: boolean;
  isCouncilMode: boolean;
  isFirstMessage: boolean;
  sendMessage: (message: string, onConversationCreated?: (id: string) => void, attachments?: DocumentAttachment[], skills?: SkillTag[]) => Promise<void>;
  stopGenerating: () => void;
  onConversationCreated?: (conversationId: string) => void;
  onSendStart: () => void;
}

const ChatComposer = memo(function ChatComposer({
  conversationKey,
  loading,
  isCouncilMode,
  isFirstMessage,
  sendMessage,
  stopGenerating,
  onConversationCreated,
  onSendStart,
}: ChatComposerProps) {
  const { message, setMessage, clearDraft } = useComposerDraft(conversationKey);
  const [pendingMessage, setPendingMessage] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [skills, setSkills] = useState<SkillTag[]>([]);
  const initializeUser = useAppStore((state) => state.initializeUser);

  useEffect(() => {
    setAttachments([]);
    setSkills([]);
  }, [conversationKey]);

  // The Skills tab tags a skill on this composer.
  useEffect(() => {
    const add = (event: Event) => {
      const skill = (event as CustomEvent<SkillTag>).detail;
      if (!skill?.id) return;
      if (skills.some((item) => item.id === skill.id) || skills.length >= MAX_SKILLS_PER_MESSAGE) {
        event.preventDefault();
        return;
      }
      setSkills([...skills, { id: skill.id, name: skill.name }]);
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus();
    };
    window.addEventListener(ADD_SKILL_EVENT, add);
    return () => window.removeEventListener(ADD_SKILL_EVENT, add);
  }, [skills]);

  useEffect(() => {
    const add = (event: Event) => {
      const file = (event as CustomEvent<DocumentAttachment>).detail;
      if (!file?.documentId) return;
      if (attachments.some((item) => item.documentId === file.documentId) ||
        attachments.length >= 4 ||
        attachments.reduce((sum, item) => sum + item.size, file.size) > 10 * 1024 * 1024) {
        event.preventDefault();
        return;
      }
      setAttachments([...attachments, file]);
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus();
    };
    window.addEventListener('chatterstack:add-document', add);
    return () => window.removeEventListener('chatterstack:add-document', add);
  }, [attachments]);

  const sendNow = useCallback(
    async (text: string, files: DocumentAttachment[] = [], tags: SkillTag[] = []) => {
      onSendStart();
      await sendMessage(text, onConversationCreated, files, tags);
    },
    [onSendStart, sendMessage, onConversationCreated]
  );

  const handleSendMessage = useCallback(async () => {
    if ((!message.trim() && attachments.length === 0) || loading) return;

    // Re-read auth state fresh: the render-time `user` can be stale right
    // after an OAuth redirect, which previously re-opened the login modal
    // even though the user was already authenticated.
    const freshUser = useAppStore.getState().user;
    const authenticated = freshUser && freshUser.id && freshUser.id !== 'guest';

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
    const filesToSend = attachments;
    const skillsToSend = skills;
    clearDraft();
    setAttachments([]);
    setSkills([]);
    await sendNow(messageToSend, filesToSend, skillsToSend);
  }, [message, attachments, skills, loading, sendNow, clearDraft]);

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
  }, [setMessage]);

  const handleLoginSuccess = useCallback(
    async (authenticatedUser: User | null) => {
      setShowLoginModal(false);

      // Ensure the store has the fresh user (the modal may have fired before
      // the page's own initialization ran).
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

      // Files stay in the composer while the modal is open, so send them
      // with the text (or on their own).
      if ((textToSend || attachments.length > 0) && isValid) {
        try {
          sessionStorage.removeItem('pendingChatMessage');
        } catch {
          // ignore
        }

        const filesToSend = attachments;
        const skillsToSend = skills;
        clearDraft();
        setAttachments([]);
        setSkills([]);
        await sendNow(textToSend, filesToSend, skillsToSend);
        setPendingMessage('');
      }
    },
    [pendingMessage, attachments, skills, initializeUser, sendNow, clearDraft]
  );

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
  }, [pendingMessage, setMessage]);

  const applyStarterPrompt = useCallback((prompt: string) => {
    setMessage(prompt);
    window.setTimeout(() => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  }, [setMessage]);

  return (
    <>
      <div className="relative z-20 shrink-0 bg-gradient-to-t from-[#191919] via-[#191919] to-[#191919]/90 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        <div className="mx-auto max-w-[720px]">
          <MessageInput
            message={message}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            skills={skills}
            onSkillsChange={setSkills}
            onMessageChange={setMessage}
            onSendMessage={handleSendMessage}
            onStopGenerating={stopGenerating}
            loading={loading}
            placeholder={isCouncilMode ? 'Ask the council anything' : 'Ask anything'}
          />
          {isFirstMessage && !isCouncilMode && (
            <div className="mx-auto mt-4 grid w-full max-w-[720px] grid-cols-2 gap-2 text-left">
              {starterPrompts.map(({ label, prompt, Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => applyStarterPrompt(prompt)}
                  className="group flex min-h-12 items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.025] px-3 text-[13px] text-[#c9c5c0] transition-colors hover:border-white/20 hover:bg-white/[0.055] hover:text-white max-[340px]:gap-1.5 max-[340px]:px-2 sm:gap-3 sm:px-4 sm:text-sm"
                >
                  <Icon className="h-4 w-4 shrink-0 text-[#8f8b86] transition-colors group-hover:text-[#d8d4ce]" strokeWidth={1.7} />
                  {label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-center text-xs leading-5 text-[#aaa6a2]">
            ChatterStack can make mistakes. Check important information.
          </p>
        </div>
      </div>

      <LoginModal
        isOpen={showLoginModal}
        onClose={handleLoginModalClose}
        onLoginSuccess={handleLoginSuccess}
        message="Sign in to start chatting"
      />
    </>
  );
});

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  selectedConversationId,
  initialConversation,
  onConversationCreated,
  mobileMenuOpen = false,
  sidebarCollapsed = false,
  conversationMissing = false,
}) => {
  // ChatPage owns the active conversation (URL + optimistic click target), so
  // the interface just follows the prop. Subscribing to the store's id here
  // too let the two disagree for a frame during navigation.
  const conversationKey = selectedConversationId ?? 'new';

  const {
    messages,
    loading,
    error,
    councilProgress,
    sendMessage,
    clearError,
    stopGenerating,
  } = useChat(conversationKey);

  const { councilMode: isCouncilMode } = useModelSelection();
  const conversationTitle = useAppStore(
    (state) => state.conversations.find((conversation) => conversation.id === conversationKey)?.title
  );
  const conversationListed = useAppStore((state) =>
    state.conversations.some((conversation) => conversation.id === conversationKey)
  );
  const renameConversation = useAppStore((state) => state.renameConversation);
  const handleRename = useCallback(
    (title: string) => {
      renameConversation(conversationKey, title).catch((error) => console.error('Failed to rename chat:', error));
    },
    [renameConversation, conversationKey]
  );

  const initialMessages =
    initialConversation?.id === conversationKey ? initialConversation.messages : undefined;
  const activeMessages = messages.length > 0 ? messages : initialMessages ?? EMPTY_MESSAGES;

  const firstUserContent = activeMessages.find((item) => item.role === 'user')?.content;
  const initialTitle =
    initialConversation?.id === conversationKey ? initialConversation.title : undefined;
  const displayTitle = conversationTitle || initialTitle || firstUserContent || 'Conversation';
  // Only the draft chat is "empty". A conversation that has an id but no
  // messages yet is still loading (or missing), so it gets a skeleton instead
  // of the hero empty state.
  const isNewChat = conversationKey === 'new';
  const isFirstMessage = isNewChat && !conversationMissing;
  const showSkeleton = !isFirstMessage && activeMessages.length === 0 && !conversationMissing;

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  // Land at the bottom once per conversation switch, before paint, so the
  // new chat never shows a frame scrolled to the top.
  useLayoutEffect(() => {
    autoScrollEnabledRef.current = true;
    setShowJumpToLatest(false);
    scrollToBottom();
  }, [conversationKey, scrollToBottom]);

  // Switching chats doesn't go through the server, so generateMetadata
  // doesn't run; keep the tab title in step here.
  const documentTitle = isFirstMessage ? 'ChatterStack' : `${displayTitle} · ChatterStack`;
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  // Follow new content (a loaded chat, each stream flush) before paint, so
  // it never shows a frame out of place. Stream flushes are already batched
  // (useChat), so this is at most one scroll write per flush.
  const lastContentLength = activeMessages[activeMessages.length - 1]?.content.length ?? 0;
  useLayoutEffect(() => {
    if (autoScrollEnabledRef.current) scrollToBottom();
  }, [activeMessages, lastContentLength, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (distanceFromBottom > 100) {
      autoScrollEnabledRef.current = false;
      setShowJumpToLatest(true);
    } else if (distanceFromBottom < 10) {
      autoScrollEnabledRef.current = true;
      setShowJumpToLatest(false);
    }
  }, []);

  const handleSendStart = useCallback(() => {
    autoScrollEnabledRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    autoScrollEnabledRef.current = true;
    setShowJumpToLatest(false);
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  // One rail tick per question. Nothing to navigate while the chat is the
  // draft state, still loading, or holds a single question.
  const turns = useMemo(
    () => (isFirstMessage || showSkeleton ? EMPTY_TURNS : buildTurns(activeMessages)),
    [activeMessages, isFirstMessage, showSkeleton]
  );

  return (
    <div className={`relative flex h-full min-h-0 flex-col bg-[#191919] text-[#efeeec] ${isFirstMessage ? 'chat-empty-shell justify-center' : ''}`}>
      <ChatHeader
        title={isFirstMessage ? 'ChatterStack' : displayTitle}
        isFirstMessage={isFirstMessage}
        mobileMenuOpen={mobileMenuOpen}
        sidebarCollapsed={sidebarCollapsed}
        onRename={!isFirstMessage && conversationListed ? handleRename : undefined}
      />

      {error && (
        <div role="alert" className="mx-4 mt-2 flex w-auto items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3.5 py-2.5 text-[13px] text-red-200 sm:mx-auto sm:w-full sm:max-w-[720px]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={clearError} className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium text-red-300/80 transition-colors hover:bg-red-500/10 hover:text-red-200">Dismiss</button>
        </div>
      )}

      {conversationMissing ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-[#b3afa9]">This conversation isn&apos;t available.</p>
          <button
            type="button"
            onClick={dispatchNewChat}
            className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-[#e6e3de] transition-colors hover:bg-white/[0.08]"
          >
            Start a new chat
          </button>
        </div>
      ) : (
        <>
          <div className={`relative flex min-h-0 ${isFirstMessage ? 'shrink-0' : 'flex-1'}`}>
            <TurnNavigator containerRef={messagesContainerRef} turns={turns} />
            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="relative z-10 min-h-0 w-full flex-1 overflow-y-auto overscroll-contain"
            >
              {isFirstMessage ? (
                <EmptyState isCouncilMode={isCouncilMode} />
              ) : showSkeleton ? (
                <ConversationSkeleton />
              ) : (
                <MessageList
                  messages={activeMessages}
                  loading={loading}
                  councilProgress={councilProgress}
                />
              )}
            </div>
          </div>

          <div className="relative">
            {showJumpToLatest && !isFirstMessage && (
              <button
                type="button"
                onClick={handleJumpToLatest}
                className="absolute -top-12 left-1/2 z-30 flex min-h-10 -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-[#292929] px-4 text-xs text-white shadow-lg"
              >
                <ArrowDown className="h-3.5 w-3.5" /> Jump to latest
              </button>
            )}

            <ChatComposer
              conversationKey={conversationKey}
              loading={loading}
              isCouncilMode={isCouncilMode}
              isFirstMessage={isFirstMessage}
              sendMessage={sendMessage}
              stopGenerating={stopGenerating}
              onConversationCreated={onConversationCreated}
              onSendStart={handleSendStart}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default memo(ChatInterface);
