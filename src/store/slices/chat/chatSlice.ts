import { StateCreator } from 'zustand';
import type { CouncilProgress, DocumentAttachment, Message } from '@/src/types/chat.types';
import type { SendSettings } from '@/src/context/ModelSelectionContext';

export type { CouncilProgress };

export interface ChatState {
  messages: Message[];
  loading: boolean;
  error?: string;
  councilProgress: CouncilProgress[];
}

/** A message written while a reply was streaming, waiting for its turn. */
export interface QueuedMessage {
  id: string;
  content: string;
  attachments: DocumentAttachment[];
  /** The model and thinking chosen when it was queued; it is sent with these. */
  settings: SendSettings;
  /** Open in the editor: never sent automatically until the edit is done. */
  editing?: boolean;
}

const initialChatState: ChatState = {
  messages: [],
  loading: false,
  error: undefined,
  councilProgress: [],
};

export interface ChatSlice {
  chatState: Record<string, ChatState>;
  setChatState: (conversationId: string, state: Partial<ChatState>) => void;
  /** Move an in-flight state from the draft key ('new') to the real conversation id. */
  moveChatState: (from: string, to: string) => void;
  clearChatState: (conversationId: string) => void;

  /** Messages waiting to be sent, per conversation, in send order. */
  queues: Record<string, QueuedMessage[]>;
  /**
   * Conversations whose queue is on hold (the user pressed Stop, or a reply
   * failed). A held queue only sends when the user picks a message.
   */
  queuesPaused: Record<string, boolean>;
  enqueueMessage: (conversationId: string, message: QueuedMessage) => void;
  updateQueuedMessage: (conversationId: string, id: string, patch: Partial<Pick<QueuedMessage, 'content' | 'editing'>>) => void;
  removeQueuedMessage: (conversationId: string, id: string) => void;
  /** Move a queued message to `toIndex` (0 sends it next). */
  moveQueuedMessage: (conversationId: string, id: string, toIndex: number) => void;
  /** Remove and return the next message that isn't being edited, if any. */
  takeNextQueuedMessage: (conversationId: string) => QueuedMessage | undefined;
  setQueuePaused: (conversationId: string, paused: boolean) => void;
  /** Move a queue (and its hold) to another key, e.g. back to the draft. */
  moveQueue: (from: string, to: string) => void;
  clearQueue: (conversationId: string) => void;
}

function withQueue(queues: Record<string, QueuedMessage[]>, conversationId: string, queue: QueuedMessage[]) {
  const next = { ...queues };
  if (queue.length) next[conversationId] = queue;
  else delete next[conversationId];
  return { queues: next };
}

export const createChatSlice: StateCreator<ChatSlice> = (set, get) => ({
  chatState: {},

  setChatState: (conversationId, updates) =>
    set((state) => {
      const current = state.chatState[conversationId] ?? initialChatState;
      return {
        chatState: {
          ...state.chatState,
          [conversationId]: { ...current, ...updates },
        },
      };
    }),

  moveChatState: (from, to) =>
    set((state) => {
      if (from === to || !state.chatState[from]) return state;

      const chatState = { ...state.chatState };
      const moved = chatState[from];
      const target = chatState[to];
      delete chatState[from];
      chatState[to] = target ? { ...target, ...moved } : moved;
      return { chatState };
    }),

  clearChatState: (conversationId) =>
    set((state) => {
      if (!(conversationId in state.chatState)) return state;
      const rest = { ...state.chatState };
      delete rest[conversationId];
      return { chatState: rest };
    }),

  queues: {},
  queuesPaused: {},

  enqueueMessage: (conversationId, message) =>
    set((state) => withQueue(state.queues, conversationId, [...(state.queues[conversationId] ?? []), message])),

  updateQueuedMessage: (conversationId, id, patch) =>
    set((state) => {
      const queue = state.queues[conversationId];
      if (!queue?.some((item) => item.id === id)) return state;
      return withQueue(state.queues, conversationId, queue.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    }),

  removeQueuedMessage: (conversationId, id) =>
    set((state) => {
      const queue = state.queues[conversationId];
      if (!queue?.some((item) => item.id === id)) return state;
      return withQueue(state.queues, conversationId, queue.filter((item) => item.id !== id));
    }),

  moveQueuedMessage: (conversationId, id, toIndex) =>
    set((state) => {
      const queue = state.queues[conversationId] ?? [];
      const from = queue.findIndex((item) => item.id === id);
      const to = Math.max(0, Math.min(toIndex, queue.length - 1));
      if (from === -1 || from === to) return state;
      const next = queue.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return withQueue(state.queues, conversationId, next);
    }),

  takeNextQueuedMessage: (conversationId) => {
    const queue = get().queues[conversationId] ?? [];
    const next = queue.find((item) => !item.editing);
    if (next) set((state) => withQueue(state.queues, conversationId, queue.filter((item) => item !== next)));
    return next;
  },

  setQueuePaused: (conversationId, paused) =>
    set((state) => {
      if (Boolean(state.queuesPaused[conversationId]) === paused) return state;
      const queuesPaused = { ...state.queuesPaused };
      if (paused) queuesPaused[conversationId] = true;
      else delete queuesPaused[conversationId];
      return { queuesPaused };
    }),

  moveQueue: (from, to) =>
    set((state) => {
      const queue = state.queues[from];
      if (from === to || !queue) return state;
      const queues = { ...state.queues, [to]: [...(state.queues[to] ?? []), ...queue] };
      delete queues[from];
      const queuesPaused = { ...state.queuesPaused };
      if (queuesPaused[from]) queuesPaused[to] = true;
      delete queuesPaused[from];
      return { queues, queuesPaused };
    }),

  clearQueue: (conversationId) =>
    set((state) => {
      if (!state.queues[conversationId] && !state.queuesPaused[conversationId]) return state;
      const queues = { ...state.queues };
      const queuesPaused = { ...state.queuesPaused };
      delete queues[conversationId];
      delete queuesPaused[conversationId];
      return { queues, queuesPaused };
    }),
});
