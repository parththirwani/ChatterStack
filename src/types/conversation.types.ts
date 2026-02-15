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
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}