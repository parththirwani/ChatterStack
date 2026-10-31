import type { ThinkingLevel } from '@/src/config/models';
import type { User } from './user.types';
import type { Conversation } from './conversation.types';
import type { SkillTag } from './skill.types';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id?: string;
  /** Stable React key while a local message receives its database id. */
  clientKey?: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  modelId?: string; // Track which LLM generated the response
  /** Thinking level the reply was generated with, so Retry can replay it. */
  thinkingLevel?: ThinkingLevel;
  reasoning?: string;
  reasoningStartedAt?: number;
  reasoningDurationMs?: number;
  analytics?: CompletionAnalytics;
  council?: CouncilDetails;
  attachments?: AttachmentMeta[];
  /** Live-session only: older turns were summarized before this reply. */
  contextCompacted?: ContextCompactionInfo;
  /** Skills tagged on a user message. */
  skills?: SkillTag[];
  /** MCP tool calls made during this assistant turn, in model order. */
  toolCalls?: MessageToolCallView[];
  /** Live-session only: the call being approved or run right now. */
  toolCall?: LiveToolCallView;
  /** Live-session only: tool discovery or loop-limit notes for this turn. */
  toolNotices?: string[];
  /** Row order within the saved chat; absent on unsent or legacy messages. */
  position?: number;
}

/** How one MCP tool call ended; mirrors the loop's statuses. */
export type ToolCallState =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'not_approved'
  | 'invalid_arguments'
  | 'not_enabled'
  | 'too_large'
  | 'repeated'
  | 'cancelled'
  | 'timed_out';

export type ToolCallApproval = 'approved' | 'denied' | 'expired' | 'not_requested';

/** One persisted tool call, safe to send to the browser. */
export interface MessageToolCallView {
  callId: string;
  /** The normalized function name the model used. */
  name: string;
  /** The server's own tool name. */
  toolId: string;
  connectionId: string;
  arguments: string;
  status: ToolCallState;
  approval: ToolCallApproval;
  /** The bounded text handed back to the model. */
  result: string;
  truncated: boolean;
  error?: string;
}

/** The approval request behind a pending call; the id spends itself once. */
export interface ToolApprovalRequestView {
  approvalId: string;
  callId: string;
  name: string;
  toolId: string;
  connectionId: string;
  arguments: Record<string, unknown>;
  round: number;
  expiresAt: number;
}

/** Live-session only: a call the user has to decide, or one still running. */
export interface LiveToolCallView {
  callId: string;
  name: string;
  state: 'pending' | 'deciding' | 'running' | 'lost';
  approvalId?: string;
  arguments?: Record<string, unknown>;
  expiresAt?: number;
  /** Why the decision never landed, for `lost`. */
  error?: string;
}

export interface AttachmentMeta {
  documentId?: string;
  removed?: boolean;
  name: string;
  mimeType: string;
  size: number;
}

export interface ChatAttachment extends AttachmentMeta {
  /** Base64 payload, without a data URL prefix. */
  data: string;
}

export interface DocumentAttachment extends AttachmentMeta {
  documentId: string;
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

export type CouncilStage = 'stage1' | 'stage2' | 'stage3';

/** How long one model call took (council mode reports every member). */
export interface ModelTiming {
  model: string;
  stage: CouncilStage;
  durationMs: number;
}

/** Reported by the server once a completion finishes; live-session only. */
export interface CompletionAnalytics {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Council mode: per-model timings behind `durationMs`. */
  timings?: ModelTiming[];
}

/** The model view for this turn used a summary of older turns. */
export interface ContextCompactionInfo {
  throughMessageId: string;
  inputTokensBefore: number;
  inputTokensAfter: number;
  summaryTokens: number;
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
  attachments?: DocumentAttachment[];
  /** Ids of the skills tagged on this message. */
  skills?: string[];
  conversationId?: string;
  selectedModel: string; // single model per request
  thinkingLevel?: ThinkingLevel;
  council?: { members: string[]; chair: string };
  /** conversationId is a client-generated id for a chat that doesn't exist yet. */
  newConversation?: boolean;
  /** Regenerates the last answer: the saved question/answer pair is replaced. */
  retry?: boolean;
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
import { MAX_SKILLS_PER_MESSAGE } from '@/src/lib/skills/skill-file';

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().max(1000),
  attachments: z.array(z.object({
    documentId: z.string().uuid(),
    name: z.string().min(1).max(180),
    mimeType: z.string().min(1).max(100),
    size: z.number().int().positive().max(5 * 1024 * 1024),
  }).strict()).max(4).optional(),
  skills: z.array(z.string().uuid())
    .max(MAX_SKILLS_PER_MESSAGE, `Tag up to ${MAX_SKILLS_PER_MESSAGE} skills`)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate skill')
    .optional(),
  selectedModel: z.string().refine(
    (id) => id === 'council' || isChatModelId(id),
    'Unsupported model'
  ),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  newConversation: z.boolean().optional(),
  retry: z.boolean().optional(),
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
}).refine((request) => request.message.length > 0 || Boolean(request.attachments?.length), {
  message: 'Add a message or a file',
  path: ['message'],
}).refine((request) => (request.attachments ?? []).reduce((size, file) => size + file.size, 0) <= 10 * 1024 * 1024, {
  message: 'Files exceed 10 MB in total',
  path: ['attachments'],
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
  /** Tokens and timing for the completion that just finished. */
  analytics?: CompletionAnalytics;
  /** Database ids for the exchange just saved. */
  savedMessages?: { userMessageId: string; assistantMessageId?: string };
  /** Older turns were summarized for this request. */
  contextCompacted?: ContextCompactionInfo;
  /** A connection's tool list could not be fetched; its tools were skipped. */
  toolDiscoveryFailed?: { connectionId: string; error: string };
  /** The model asked for this call; the user's decision spends the approval id. */
  toolApprovalRequest?: ToolApprovalRequestView;
  /** An approved call started executing. */
  toolCallStarted?: { callId: string; name: string };
  /** A call finished successfully; the model already saw the result. */
  toolCallResult?: MessageToolCallView;
  /** A call ended without a result: denied, failed, cancelled or capped. */
  toolCallFailure?: MessageToolCallView;
  /** A loop limit was reached; the answer was written without more tools. */
  toolLoopStopped?: { limit: string; message: string };
}
