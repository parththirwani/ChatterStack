import type { User } from './user.types';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id?: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  modelId?: string; // Track which LLM generated the response
}

export interface ChatSettings {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatState {
  messages: Message[];
  currentConversationId?: string;
  loading: boolean;
  error?: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  selectedModel: string; // single model per request
}

export interface ChatInterfaceProps {
  user?: User | null;
  selectedConversationId?: string;
  onConversationCreated?: (conversationId: string) => void;
  onNewChatStarted?: () => void;
}

import { z } from 'zod';

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(1000),
  selectedModel: z.string(),
});

export enum Role {
  Assistant = 'assistant',
  User = 'user',
}

export interface MessageType {
  role: Role;
  content: string;
  modelId?: string;
}

export interface SSEData {
  status?: string;
  chunk?: string;
  error?: string;
  conversationId?: string;
  done?: boolean;
  progress?: number;
  stage?: string;
  model?: string;
}