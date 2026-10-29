import type { Message } from './chat.types';

export type ConversationStatus = 'active' | 'archived' | 'deleted';

export interface ConversationFilter {
  status?: ConversationStatus;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export interface Conversation {
  id: string;
  title?: string;
  /** ISO time the chat was pinned; null/undefined when not pinned. */
  pinnedAt?: string | null;
  /** Set on a scheduled task's run chats, which stay out of Recents. */
  scheduledTaskId?: string | null;
  /** Source chat and cut point for a fork. The source may later be deleted. */
  parentConversationId?: string | null;
  forkedFromMessageId?: string | null;
  /** Present on a full chat read when its source still exists. */
  forkSource?: { id: string; title?: string } | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}
