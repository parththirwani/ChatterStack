/**
 * The analytics vocabulary: every event name and its property shape lives here.
 *
 * Hard rule for anything added below: no message text, titles, filenames,
 * document contents or retrieved context. Sizes are bucketed, identities are
 * the NextAuth user id.
 */
export const AnalyticsEvents = {
  SignInStarted: 'sign_in_started',
  ChatMessageSent: 'chat_message_sent',
  ChatMessageRetried: 'chat_message_retried',
  ChatResponseCompleted: 'chat_response_completed',
  CouncilRunCompleted: 'council_run_completed',
  ConversationCreated: 'conversation_created',
  ConversationPinned: 'conversation_pinned',
  ConversationDeleted: 'conversation_deleted',
  DocumentUploaded: 'document_uploaded',
  DocumentFavorited: 'document_favorited',
  DocumentDeleted: 'document_deleted',
  ModelChanged: 'model_changed',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export type MessageLengthBucket = '0' | '1-99' | '100-499' | '500-1999' | '2000-7999' | '8000+';
export type SizeBucket = '<100kb' | '100kb-500kb' | '500kb-1mb' | '1mb-5mb' | '5mb+';
export type ChatResponseOutcome = 'success' | 'error' | 'stopped';

export interface SignInStartedProps {
  provider: 'google' | 'github';
}

export interface ChatMessageSentProps {
  model_id: string;
  council: boolean;
  thinking_level: string;
  attachment_count: number;
  message_length_bucket: MessageLengthBucket;
}

export interface ChatMessageRetriedProps {
  model_id: string;
  council: boolean;
  thinking_level: string;
}

export interface ChatResponseCompletedProps {
  model_id: string;
  council: boolean;
  outcome: ChatResponseOutcome;
  duration_ms: number;
}

export interface CouncilRunCompletedProps {
  members: number;
  outcome: ChatResponseOutcome;
  duration_ms: number;
}

export interface ConversationCreatedProps {
  council: boolean;
}

export interface ConversationPinnedProps {
  pinned: boolean;
}

export interface DocumentUploadedProps {
  mime_type: string;
  size_bucket: SizeBucket;
}

export interface DocumentFavoritedProps {
  favorite: boolean;
}

export interface ModelChangedProps {
  model_id: string;
}

/** Every event name mapped to the exact properties it may carry. */
export interface AnalyticsEventProps {
  sign_in_started: SignInStartedProps;
  chat_message_sent: ChatMessageSentProps;
  chat_message_retried: ChatMessageRetriedProps;
  chat_response_completed: ChatResponseCompletedProps;
  council_run_completed: CouncilRunCompletedProps;
  conversation_created: ConversationCreatedProps;
  conversation_pinned: ConversationPinnedProps;
  conversation_deleted: Record<string, never>;
  document_uploaded: DocumentUploadedProps;
  document_favorited: DocumentFavoritedProps;
  document_deleted: Record<string, never>;
  model_changed: ModelChangedProps;
}

export function messageLengthBucket(length: number): MessageLengthBucket {
  if (!(length > 0)) return '0';
  if (length < 100) return '1-99';
  if (length < 500) return '100-499';
  if (length < 2000) return '500-1999';
  if (length < 8000) return '2000-7999';
  return '8000+';
}

export function sizeBucket(bytes: number): SizeBucket {
  if (!(bytes > 0)) return '<100kb';
  if (bytes < 100 * 1024) return '<100kb';
  if (bytes < 500 * 1024) return '100kb-500kb';
  if (bytes < 1024 * 1024) return '500kb-1mb';
  if (bytes < 5 * 1024 * 1024) return '1mb-5mb';
  return '5mb+';
}

const elapsed = (startedAt: number) => Math.max(0, Math.round(Date.now() - startedAt));

export function chatMessageSentProps(input: {
  modelId: string;
  council: boolean;
  thinkingLevel: string;
  attachmentCount: number;
  messageLength: number;
}): ChatMessageSentProps {
  return {
    model_id: input.modelId,
    council: input.council,
    thinking_level: input.thinkingLevel,
    attachment_count: input.attachmentCount,
    message_length_bucket: messageLengthBucket(input.messageLength),
  };
}

export function chatMessageRetriedProps(input: {
  modelId: string;
  council: boolean;
  thinkingLevel: string;
}): ChatMessageRetriedProps {
  return {
    model_id: input.modelId,
    council: input.council,
    thinking_level: input.thinkingLevel,
  };
}

export function chatResponseCompletedProps(input: {
  modelId: string;
  council: boolean;
  startedAt: number;
  outcome: ChatResponseOutcome;
}): ChatResponseCompletedProps {
  return {
    model_id: input.modelId,
    council: input.council,
    outcome: input.outcome,
    duration_ms: elapsed(input.startedAt),
  };
}

export function councilRunCompletedProps(input: {
  members: number;
  startedAt: number;
  outcome: ChatResponseOutcome;
}): CouncilRunCompletedProps {
  return {
    members: input.members,
    outcome: input.outcome,
    duration_ms: elapsed(input.startedAt),
  };
}
