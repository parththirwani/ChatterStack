import { useCallback, useLayoutEffect, useRef } from 'react';
import { ApiService } from '../services/api';
import { showConversation } from '../lib/navigation';
import { cacheInvalidators } from '../services/apiOptimizer';
import { useModelSelection } from '../context/ModelSelectionContext';
import type { ChatAttachment, CouncilProgress, Message } from '@/src/types/chat.types';
import type { ChatState } from '@/src/store/slices/chat/chatSlice';
import { useAppStore } from '@/src/store/rootStore';

const EMPTY_CHAT_STATE: ChatState = {
  messages: [],
  loading: false,
  councilProgress: [],
};

// Streaming arrives token by token. Re-parsing markdown, running
// rehype-highlight and re-rendering the list for every token is the single
// most expensive thing the app does, so coalesce updates to ~25fps.
const STREAM_FLUSH_MS = 40;

// In-flight requests by conversation id. A stream belongs to its conversation,
// not to whichever chat is on screen, so starting a new chat or switching
// away never cancels it; Stop cancels only the conversation you're viewing.
const activeRequests = new Map<string, AbortController>();

let localMessageCounter = 0;
function nextLocalId(prefix: 'user' | 'assistant') {
  localMessageCounter += 1;
  return `${prefix}-local-${Date.now()}-${localMessageCounter}`;
}

/**
 * Chat state for one conversation key. The key is the URL conversation id,
 * or `'new'` for an unsaved draft. Keeping the key as an argument (instead of
 * reading it from the global store inside the hook) means a navigation never
 * shows the previous conversation's messages while the next one loads.
 */
export const useChat = (conversationKey: string) => {
  // Read at send time through a ref, so sendMessage keeps its identity when
  // the model or thinking level changes (it's a prop of the memoized composer).
  const modelSelection = useModelSelection();
  const modelSelectionRef = useRef(modelSelection);
  useLayoutEffect(() => {
    modelSelectionRef.current = modelSelection;
  });

  const chatState = useAppStore(
    useCallback(
      (state) => state.chatState[conversationKey] ?? EMPTY_CHAT_STATE,
      [conversationKey]
    )
  );

  const stopGenerating = useCallback(() => {
    activeRequests.get(conversationKey)?.abort();
  }, [conversationKey]);

  const sendMessage = useCallback(
    async (
      message: string,
      onConversationCreated?: (conversationId: string) => void,
      attachments: ChatAttachment[] = []
    ) => {
      // Read the user fresh from the store: the render-time closure can be
      // stale right after an OAuth redirect.
      const freshUser = useAppStore.getState().user;
      const { activeModelId, thinkingLevel, councilMembers, councilChair } = modelSelectionRef.current;
      const store = useAppStore.getState();
      if (
        (!message.trim() && attachments.length === 0) ||
        !freshUser?.id ||
        freshUser.id === 'guest' ||
        store.chatState[conversationKey]?.loading
      ) {
        return;
      }

      const isNewConversation = conversationKey === 'new';
      const isCouncilMode = activeModelId === 'council';
      // A new chat gets its real id now, so it can appear in the sidebar and
      // keep streaming into its own slot if the user starts another chat.
      const key = isNewConversation ? crypto.randomUUID() : conversationKey;
      let created = !isNewConversation;

      const abortController = new AbortController();
      activeRequests.set(key, abortController);

      const now = new Date().toISOString();
      const userMessage: Message = {
        id: nextLocalId('user'),
        role: 'user',
        content: message,
        attachments: attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
        createdAt: now,
      };
      const aiMessage: Message = {
        // Stable id from the start: changing it on completion used to remount
        // the whole markdown tree (and re-highlight every code block).
        id: nextLocalId('assistant'),
        role: 'assistant',
        content: '',
        modelId: activeModelId,
        createdAt: now,
        council: isCouncilMode
          ? { members: [...councilMembers], chair: councilChair, answers: [], rankings: [] }
          : undefined,
      };

      const previousMessages = (store.chatState[key] ?? EMPTY_CHAT_STATE).messages;

      // Add the user bubble and the assistant placeholder in one update.
      store.setChatState(key, {
        messages: [...previousMessages, userMessage, aiMessage],
        loading: true,
        error: undefined,
        councilProgress: isCouncilMode ? [] : (store.chatState[key] ?? EMPTY_CHAT_STATE).councilProgress,
      });

      if (isNewConversation) {
        store.clearChatState('new');
        store.addConversation({
          id: key,
          userId: freshUser.id,
          createdAt: now,
          updatedAt: now,
          pinnedAt: null,
          messages: [userMessage],
        });
        store.setCurrentConversationId(key);
        onConversationCreated?.(key);
      }

      let fullResponse = '';
      let reasoning = '';
      let reasoningStartedAt: number | undefined;
      let reasoningDurationMs: number | undefined;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let lastFlushAt = 0;
      let dirty = false;

      const patchStreamingMessage = (patch: (msg: Message) => Partial<Message>) => {
        const fresh = useAppStore.getState();
        const chat = fresh.chatState[key] ?? EMPTY_CHAT_STATE;
        const index = chat.messages.length - 1;
        const last = chat.messages[index];
        if (!last || last.role !== 'assistant') return;

        const messages = chat.messages.slice();
        messages[index] = { ...last, ...patch(last) };
        fresh.setChatState(key, { messages });
      };

      const reasoningPatch = () => {
        if (reasoningStartedAt && reasoningDurationMs === undefined && fullResponse.length > 0) {
          reasoningDurationMs = Date.now() - reasoningStartedAt;
        }
        return reasoningStartedAt
          ? { reasoning, reasoningStartedAt, reasoningDurationMs }
          : {};
      };

      const flush = () => {
        flushTimer = null;
        if (!dirty) return;
        dirty = false;
        lastFlushAt = Date.now();
        const reasoningFields = reasoningPatch();
        patchStreamingMessage(() => ({ content: fullResponse, ...reasoningFields }));
      };

      const scheduleFlush = () => {
        if (flushTimer !== null) return;
        const elapsed = Date.now() - lastFlushAt;
        flushTimer = setTimeout(flush, Math.max(0, STREAM_FLUSH_MS - elapsed));
      };

      const flushNow = () => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flush();
      };

      // The row now exists on the server, so the URL can point at it. Only
      // navigate if the user is still looking at this chat.
      const handleConversationCreated = () => {
        created = true;
        cacheInvalidators.conversationList();
        if (useAppStore.getState().currentConversationId === key) {
          showConversation(key, { replace: true });
        }
      };

      // Progress handler for council mode. Progress events are infrequent, so
      // they are applied immediately instead of being coalesced.
      const handleProgress = (progress: CouncilProgress) => {
        const fresh = useAppStore.getState();
        const chat = fresh.chatState[key] ?? EMPTY_CHAT_STATE;
        const existing = chat.councilProgress?.find(
          (item) => item.stage === progress.stage && item.model === progress.model
        );

        const councilProgress = existing
          ? chat.councilProgress.map((item) =>
              item.stage === progress.stage && item.model === progress.model ? progress : item
            )
          : [...(chat.councilProgress ?? []), progress];

        fresh.setChatState(key, { councilProgress });
      };

      try {
        await ApiService.sendMessage(
          {
            message,
            attachments,
            conversationId: key,
            newConversation: isNewConversation || undefined,
            selectedModel: activeModelId,
            thinkingLevel,
            council: isCouncilMode
              ? { members: councilMembers, chair: councilChair }
              : undefined,
          },
          {
            onChunk: (chunk: string) => {
              fullResponse += chunk;
              dirty = true;
              scheduleFlush();
            },
            onReasoning: (chunk: string) => {
              reasoning += chunk;
              reasoningStartedAt ??= Date.now();
              dirty = true;
              scheduleFlush();
            },
            onDone: flushNow,
            onConversationCreated: handleConversationCreated,
            onTitle: (title) => useAppStore.getState().updateConversation(key, { title }),
            onProgress: isCouncilMode ? handleProgress : undefined,
            onCouncilAnswer: (answer) =>
              patchStreamingMessage((msg) => ({
                council: msg.council && {
                  ...msg.council,
                  answers: [...msg.council.answers, answer],
                },
              })),
            onCouncilRankings: (rankings) =>
              patchStreamingMessage((msg) => ({
                council: msg.council && { ...msg.council, rankings },
              })),
          },
          abortController.signal
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // User stopped generation: keep whatever was streamed so far.
          flushNow();
        } else {
          const fresh = useAppStore.getState();
          const chat = fresh.chatState[key] ?? EMPTY_CHAT_STATE;
          const messages = fullResponse
            ? chat.messages
            : chat.messages.filter((item) => item.role !== 'assistant' || item.content.length > 0);
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to send message. Please try again.';

          fresh.setChatState(key, { error: errorMessage, messages });

          // The server never saved this chat (e.g. rate limited): turn it
          // back into the draft instead of leaving a phantom sidebar entry.
          if (!created) {
            fresh.removeConversation(key);
            if (fresh.currentConversationId === undefined || fresh.currentConversationId === key) {
              fresh.moveChatState(key, 'new');
              fresh.setCurrentConversationId(undefined);
            } else {
              fresh.clearChatState(key);
            }
          }
        }
      } finally {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushNow();

        const fresh = useAppStore.getState();
        if (fresh.chatState[key]) {
          fresh.setChatState(key, { loading: false, councilProgress: [] });
        }
        if (created) {
          fresh.updateConversation(key, { updatedAt: new Date().toISOString() });
        }
        if (activeRequests.get(key) === abortController) activeRequests.delete(key);
      }
    },
    [conversationKey]
  );

  const startNewConversation = useCallback(() => {
    const store = useAppStore.getState();
    store.clearChatState('new');
    store.setCurrentConversationId(undefined);
  }, []);

  const clearError = useCallback(() => {
    useAppStore.getState().setChatState(conversationKey, { error: undefined });
  }, [conversationKey]);

  return {
    messages: chatState.messages,
    loading: chatState.loading,
    error: chatState.error,
    councilProgress: chatState.councilProgress ?? [],
    sendMessage,
    startNewConversation,
    clearError,
    stopGenerating,
  };
};
