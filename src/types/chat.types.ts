import type { ThinkingLevel } from '@/src/config/models';
import type { User } from './user.types';
import type { Conversation } from './conversation.types';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id?: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  modelId?: string; // Track which LLM generated the response
  reasoning?: string;
  reasoningStartedAt?: number;
  reasoningDurationMs?: number;
  council?: CouncilDetails;
}

export interface CouncilAnswer {
  model: string;
  response: string;
}

export interface CouncilRanking {
  model: string;
  averageRank: number;
}

// Live-session only: these are streamed during deliberation and not persisted.
export interface CouncilDetails {
  members: string[];
  chair: string;
  answers: CouncilAnswer[];
  rankings: CouncilRanking[];
}

export interface CouncilProgress {
  stage: string;
  model: string;
  // 0 = working, 100 = done, -1 = skipped after an error
  progress: number;
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
  thinkingLevel?: ThinkingLevel;
  council?: { members: string[]; chair: string };
  /** conversationId is a client-generated id for a chat that doesn't exist yet. */
  newConversation?: boolean;
}

export interface ChatInterfaceProps {
  user?: User | null;
  selectedConversationId?: string;
  /** Conversation already fetched by the server for this URL. */
  initialConversation?: Conversation | null;
  conversationMissing?: boolean;
  onConversationCreated?: (conversationId: string) => void;
  onNewChatStarted?: () => void;
  mobileMenuOpen?: boolean;
  sidebarCollapsed?: boolean;
}

import { z } from 'zod';
import {
  COUNCIL_MAX_MEMBERS,
  COUNCIL_MIN_MEMBERS,
  THINKING_LEVELS,
  isChatModelId,
} from '@/src/config/models';

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(1000),
  selectedModel: z.string().refine(
    (id) => id === 'council' || isChatModelId(id),
    'Unsupported model'
  ),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  newConversation: z.boolean().optional(),
  council: z
    .object({
      members: z
        .array(z.string().refine(isChatModelId, 'Unsupported model'))
        .min(COUNCIL_MIN_MEMBERS)
        .max(COUNCIL_MAX_MEMBERS)
        .refine((members) => new Set(members).size === members.length, 'Duplicate council member'),
      chair: z.string().refine(isChatModelId, 'Unsupported model'),
    })
    .optional(),
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
  reasoning?: string;
  councilAnswer?: CouncilAnswer;
  councilRankings?: CouncilRanking[];
  /** Sent at the start of a new chat, once its row exists. */
  conversationCreated?: string;
  /** Generated title for a new chat. */
  title?: string;
}
