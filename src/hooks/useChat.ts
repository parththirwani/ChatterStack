import { useCallback, useLayoutEffect, useRef } from 'react';
import { ApiService } from '../services/api';
import { showConversation } from '../lib/navigation';
import { cacheInvalidators } from '../services/apiOptimizer';
import { useModelSelection, type SendSettings } from '../context/ModelSelectionContext';
import type { CompletionAnalytics, CouncilProgress, DocumentAttachment, Message } from '@/src/types/chat.types';
import type { ChatState, QueuedMessage } from '@/src/store/slices/chat/chatSlice';
import { useAppStore } from '@/src/store/rootStore';
import { skillTagsIn } from '@/src/lib/client/skills';
import { COUNCIL_MIN_MEMBERS, isChatModelId } from '@/src/config/models';
import type { SkillTag } from '@/src/types/skill.types';

const EMPTY_QUEUE: QueuedMessage[] = [];

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

// Passed to abort() so the request knows why it ended. Stop holds the queue;
// Steer interrupts the reply so the steered message goes out right away.
type AbortReason = 'stop' | 'steer';

let localMessageCounter = 0;
function nextLocalId(prefix: 'user' | 'assistant') {
  localMessageCounter += 1;
  return `${prefix}-local-${Date.now()}-${localMessageCounter}`;
}

async function sendToConversation(
  conversationKey: string,
  message: string,
  selection: SendSettings,
  onConversationCreated?: (conversationId: string) => void,
  attachments: DocumentAttachment[] = [],
  { retry = false }: { retry?: boolean } = {}
) {
  // Read the user fresh from the store: the render-time closure can be
  // stale right after an OAuth redirect.
  const { activeModelId, thinkingLevel, councilMembers, councilChair } = selection;
  // Skills tagged as `/name` in the text. Known at once unless the skills
  // list is still loading (just after sign-in), when this waits for it.
  const tagged = skillTagsIn(message, useAppStore.getState().user?.id);
  let skills: SkillTag[];
  if (Array.isArray(tagged)) {
    skills = tagged;
  } else {
    skills = await tagged;
    // Another message went out meanwhile: this one waits its turn instead.
    const latest = useAppStore.getState();
    if (latest.chatState[conversationKey]?.loading) {
      if (!latest.queues[conversationKey]?.length) latest.setQueuePaused(conversationKey, false);
      latest.enqueueMessage(conversationKey, {
        id: crypto.randomUUID(), content: message, attachments, settings: selection,
      });
      return;
    }
  }
  const store = useAppStore.getState();
  const freshUser = store.user;
  if ((!message.trim() && attachments.length === 0) || !canSend(conversationKey) || !freshUser?.id) {
    return;
  }

  const isNewConversation = conversationKey === 'new';
  const isCouncilMode = activeModelId === 'council';
  // Only a saved chat has an answer to replace.
  const isRetry = retry && !isNewConversation;
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
    attachments: attachments.map(({ documentId, name, mimeType, size }) => ({ documentId, name, mimeType, size })),
    skills: skills.length ? skills : undefined,
    createdAt: now,
  };
  const aiMessage: Message = {
    // Keep this as the render key after the server assigns its database id,
    // so the markdown tree stays mounted when the fork action appears.
    id: nextLocalId('assistant'),
    role: 'assistant',
    content: '',
    modelId: activeModelId,
    // Kept so Retry can resend the question with the same settings.
    thinkingLevel,
    createdAt: now,
    council: isCouncilMode
      ? { members: [...councilMembers], chair: councilChair, answers: [], rankings: [] }
      : undefined,
  };
  userMessage.clientKey = userMessage.id;
  aiMessage.clientKey = aiMessage.id;

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
    // Messages left queued in the draft (its first send failed) follow it.
    store.moveQueue('new', key);
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
  let analytics: CompletionAnalytics | undefined;
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

  let outcome: 'done' | 'aborted' | 'error' = 'done';
  try {
    await ApiService.sendMessage(
      {
        message,
        attachments,
        skills: skills.length ? skills.map((skill) => skill.id) : undefined,
        conversationId: key,
        newConversation: isNewConversation || undefined,
        selectedModel: activeModelId,
        thinkingLevel,
        council: isCouncilMode
          ? { members: councilMembers, chair: councilChair }
          : undefined,
        retry: isRetry || undefined,
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
        onAnalytics: (completion) => {
          analytics = completion;
        },
        onSavedMessages: ({ userMessageId, assistantMessageId }) => {
          const fresh = useAppStore.getState();
          const chat = fresh.chatState[key];
          if (!chat) return;
          fresh.setChatState(key, {
            messages: chat.messages.map((item) =>
              item.id === userMessage.id ? { ...item, id: userMessageId }
                : item.id === aiMessage.id && assistantMessageId ? { ...item, id: assistantMessageId }
                  : item
            ),
          });
        },
        onContextCompacted: (info) =>
          patchStreamingMessage(() => ({ contextCompacted: info })),
      },
      abortController.signal
    );
  } catch (error) {
    if (abortController.signal.aborted) {
      outcome = 'aborted';
      // User stopped generation: keep whatever was streamed so far.
      flushNow();
    } else {
      outcome = 'error';
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
          fresh.moveQueue(key, 'new');
          fresh.setCurrentConversationId(undefined);
        } else {
          fresh.clearChatState(key);
          fresh.clearQueue(key);
        }
      }
    }
  } finally {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushNow();
    // Sent files become resources only once the server has saved the message.
    if (attachments.length && typeof window !== 'undefined') window.dispatchEvent(new Event('chatterstack:documents-changed'));
    // The reply is final now: attach the tokens it used and how long it took.
    if (analytics) patchStreamingMessage(() => ({ analytics }));

    const fresh = useAppStore.getState();
    if (fresh.chatState[key]) {
      fresh.setChatState(key, { loading: false, councilProgress: [] });
    }
    if (created) {
      fresh.updateConversation(key, { updatedAt: new Date().toISOString() });
    }
    if (activeRequests.get(key) === abortController) activeRequests.delete(key);
    const abortReason: AbortReason | undefined = outcome === 'aborted' ? abortController.signal.reason : undefined;
    const queueKey = created ? key : 'new';
    // A finished (or steered) reply hands over to the next queued message.
    // Stop and errors hold the queue until the user picks a message to send.
    // A steer before the server saved the chat can't follow up in it, so the
    // steered message waits at the front instead.
    if (outcome === 'error' || abortReason === 'stop' || (abortReason === 'steer' && !created)) {
      if (fresh.queues[queueKey]?.length) fresh.setQueuePaused(queueKey, true);
    } else if (created && !fresh.queuesPaused[key]) {
      sendNextQueued(key);
    }
  }
}

/** The files of a saved question that can be sent again. */
function attachmentsToResend(message: Message): DocumentAttachment[] {
  return (message.attachments ?? []).filter((file): file is DocumentAttachment => Boolean(file.documentId));
}

/** Replays a reply with the model and thinking level it was generated with. */
function settingsOf(reply: Message, current: SendSettings): SendSettings {
  const thinkingLevel = reply.thinkingLevel ?? current.thinkingLevel;
  if (reply.modelId === 'council') {
    // The council a loaded chat was answered with isn't saved with it, so a
    // stale selection falls back to what is configured now.
    const members = (reply.council?.members ?? []).filter(isChatModelId);
    const chair = reply.council?.chair;
    return {
      activeModelId: 'council',
      thinkingLevel,
      councilMembers: members.length >= COUNCIL_MIN_MEMBERS ? members : current.councilMembers,
      councilChair: chair && isChatModelId(chair) && members.includes(chair) ? chair : current.councilChair,
    };
  }
  const model = reply.modelId;
  return model && isChatModelId(model)
    ? { ...current, activeModelId: model, thinkingLevel }
    : { ...current, thinkingLevel };
}

/** Signed in, and no reply already streaming in this conversation. */
function canSend(conversationKey: string) {
  const { user, chatState } = useAppStore.getState();
  return Boolean(user?.id) && user?.id !== 'guest' && !chatState[conversationKey]?.loading;
}

function sendNextQueued(conversationKey: string) {
  // Checked before taking the message, so one that can't go out stays queued.
  if (!canSend(conversationKey)) return;
  const next = useAppStore.getState().takeNextQueuedMessage(conversationKey);
  if (next) void sendToConversation(conversationKey, next.content, next.settings, undefined, next.attachments);
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

  const queue = useAppStore(
    useCallback((state) => state.queues[conversationKey] ?? EMPTY_QUEUE, [conversationKey])
  );

  const queuePaused = useAppStore((state) => Boolean(state.queuesPaused[conversationKey]));

  const stopGenerating = useCallback(() => {
    activeRequests.get(conversationKey)?.abort('stop' satisfies AbortReason);
  }, [conversationKey]);

  const sendMessage = useCallback(
    (
      message: string,
      onConversationCreated?: (conversationId: string) => void,
      attachments: DocumentAttachment[] = []
    ) => sendToConversation(conversationKey, message, modelSelectionRef.current, onConversationCreated, attachments),
    [conversationKey]
  );

  /**
   * Regenerate the last answer. The question is sent again and its new reply
   * takes the old one's place, on screen and in the saved chat.
   */
  const retryLastReply = useCallback(async () => {
    const store = useAppStore.getState();
    const chat = store.chatState[conversationKey];
    if (!chat || chat.loading || chat.messages.at(-1)?.role !== 'assistant') return;

    const replyIndex = chat.messages.length - 1;
    let questionIndex = -1;
    for (let index = replyIndex - 1; index >= 0; index -= 1) {
      if (chat.messages[index].role === 'user') {
        questionIndex = index;
        break;
      }
    }
    const question = chat.messages[questionIndex];
    if (!question) return;

    const settings = settingsOf(chat.messages[replyIndex], modelSelectionRef.current);
    // The pair being replaced disappears first; the resend puts the question back.
    store.setChatState(conversationKey, { messages: chat.messages.slice(0, questionIndex), error: undefined });
    await sendToConversation(
      conversationKey,
      question.content,
      settings,
      undefined,
      attachmentsToResend(question),
      { retry: true }
    );
  }, [conversationKey]);

  /**
   * Hold a message until the current reply finishes. It keeps the model and
   * thinking chosen now, even if they change before it is sent.
   */
  const queueMessage = useCallback(
    (content: string, attachments: DocumentAttachment[] = []) => {
      if (!content.trim() && attachments.length === 0) return;
      const store = useAppStore.getState();
      const { activeModelId, thinkingLevel, councilMembers, councilChair } = modelSelectionRef.current;
      // A queue that had emptied starts fresh rather than on hold.
      if (!store.queues[conversationKey]?.length) store.setQueuePaused(conversationKey, false);
      store.enqueueMessage(conversationKey, {
        id: crypto.randomUUID(),
        content,
        attachments,
        settings: { activeModelId, thinkingLevel, councilMembers: [...councilMembers], councilChair },
      });
    },
    [conversationKey]
  );

  /**
   * Send a queued message now and resume a held queue. A reply in progress
   * is interrupted (what it streamed so far is kept) and the steered message
   * goes out next.
   */
  const steerQueuedMessage = useCallback(
    (id: string) => {
      const store = useAppStore.getState();
      if (!store.queues[conversationKey]?.some((item) => item.id === id)) return;
      store.updateQueuedMessage(conversationKey, id, { editing: false });
      store.moveQueuedMessage(conversationKey, id, 0);
      store.setQueuePaused(conversationKey, false);
      const request = activeRequests.get(conversationKey);
      if (store.chatState[conversationKey]?.loading && request) {
        request.abort('steer' satisfies AbortReason);
      } else {
        sendNextQueued(conversationKey);
      }
    },
    [conversationKey]
  );

  /** Open a queued message for editing; it won't be sent until it's closed. */
  const startEditingQueued = useCallback(
    (id: string) => useAppStore.getState().updateQueuedMessage(conversationKey, id, { editing: true }),
    [conversationKey]
  );

  /**
   * Close the editor, saving `content` if given (empty with no files removes
   * the message). If the queue was waiting on this edit, it carries on.
   */
  const finishEditingQueued = useCallback(
    (id: string, content?: string) => {
      const store = useAppStore.getState();
      const item = store.queues[conversationKey]?.find((entry) => entry.id === id);
      if (!item) return;
      if (content !== undefined && !content.trim() && !item.attachments.length) {
        store.removeQueuedMessage(conversationKey, id);
      } else {
        store.updateQueuedMessage(conversationKey, id, { editing: false, ...(content !== undefined && { content }) });
      }
      if (!store.queuesPaused[conversationKey] && conversationKey !== 'new') sendNextQueued(conversationKey);
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
    queue,
    sendMessage,
    retryLastReply,
    queuePaused,
    queueMessage,
    steerQueuedMessage,
    startEditingQueued,
    finishEditingQueued,
    startNewConversation,
    clearError,
    stopGenerating,
  };
};
