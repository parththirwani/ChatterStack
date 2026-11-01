import { prisma } from '@/src/lib/prisma';
import { MESSAGE_ORDER } from '@/src/lib/server/message-order';
import type { Conversation } from '@/src/types/conversation.types';
import type { Message } from '@/src/types/chat.types';
import type { AttachmentMeta, MessageToolCallView } from '@/src/types/chat.types';
import type { SkillTag } from '@/src/types/skill.types';
import type { Prisma } from '@prisma/client';

/**
 * The one place conversations are read and shaped for the client, shared by
 * the server render (chat-data.ts) and the /api/conversations routes so both
 * hydration paths see identical data.
 */

interface MessageToolCallRow {
  callId: string;
  name: string;
  toolId: string;
  connectionId: string;
  arguments: string;
  status: string;
  approval: string;
  result: string;
  truncated: boolean;
  error: string | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string | null;
  modelId: string | null;
  attachments?: unknown;
  skills?: unknown;
  toolCalls?: unknown;
  position?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationRow {
  id: string;
  title: string | null;
  pinnedAt: Date | null;
  scheduledTaskId?: string | null;
  parentConversationId?: string | null;
  forkedFromMessageId?: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  messages: MessageRow[];
}

/** Ids still present, used to mark deleted documents and skills as removed. */
interface Present {
  documents: Set<string>;
  skills: Set<string>;
}

/** One stored MessageToolCall row as the client sees it; rows come ordered. */
function toView(row: MessageToolCallRow): MessageToolCallView {
  return {
    callId: row.callId,
    name: row.name,
    toolId: row.toolId,
    connectionId: row.connectionId,
    arguments: row.arguments,
    status: row.status as MessageToolCallView['status'],
    approval: row.approval as MessageToolCallView['approval'],
    result: row.result,
    truncated: row.truncated,
    ...(row.error ? { error: row.error } : {}),
  };
}

/** Rows → views, or undefined when there is nothing to attach (keeps payloads lean). */
export function toolCallViews(rows: unknown): MessageToolCallView[] | undefined {
  return Array.isArray(rows) && rows.length
    ? (rows as MessageToolCallRow[]).map(toView)
    : undefined;
}

function serializeMessage(message: MessageRow, present?: Present): Message {
  const toolCalls = toolCallViews(message.toolCalls);
  return {
    id: message.id,
    role: message.role as Message['role'],
    content: message.content ?? '',
    modelId: message.modelId ?? undefined,
    attachments: Array.isArray(message.attachments)
      ? (message.attachments as AttachmentMeta[]).map(({ documentId, name, mimeType, size }) => ({
        documentId, name, mimeType, size, removed: !!documentId && !!present && !present.documents.has(documentId),
      }))
      : undefined,
    skills: Array.isArray(message.skills) && message.skills.length
      ? (message.skills as SkillTag[]).map(({ id, name }) => ({ id, name, removed: !!present && !present.skills.has(id) }))
      : undefined,
    ...(toolCalls ? { toolCalls } : {}),
    // Row order within the chat; absent on messages saved before positions.
    position: message.position ?? undefined,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function serializeConversation(conversation: ConversationRow, present?: Present): Conversation {
  return {
    id: conversation.id,
    title: conversation.title ?? undefined,
    pinnedAt: conversation.pinnedAt?.toISOString() ?? null,
    scheduledTaskId: conversation.scheduledTaskId ?? null,
    parentConversationId: conversation.parentConversationId ?? null,
    forkedFromMessageId: conversation.forkedFromMessageId ?? null,
    userId: conversation.userId,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages: conversation.messages.map((message) => serializeMessage(message, present)),
  };
}

/**
 * Recents filter: a scheduled task's run chats are listed on the task's page
 * instead, so an hourly task doesn't flood the sidebar.
 */
export const recentsWhere = (userId: string) => ({ userId, scheduledTaskId: null });

/** The sidebar list: pinned first (most recently pinned on top), then by activity, each with its first message. */
export async function listConversations(
  userId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<Conversation[]> {
  const conversations = await prisma.conversation.findMany({
    where: recentsWhere(userId),
    include: { messages: { orderBy: MESSAGE_ORDER, take: 1, select: {
      id: true, role: true, content: true, modelId: true, createdAt: true, updatedAt: true,
    } } },
    orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: limit,
    skip: offset,
  });
  return conversations.map((conversation) => serializeConversation(conversation));
}

/** One conversation with all its messages, or null if it isn't this user's. */
export async function getConversation(
  userId: string,
  conversationId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Conversation | null> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: MESSAGE_ORDER, include: { toolCalls: { orderBy: { position: 'asc' } } } } },
  });
  if (!conversation) return null;
  const ids = conversation.messages.flatMap((message) =>
    Array.isArray(message.attachments)
      ? (message.attachments as unknown as AttachmentMeta[]).map((file) => file.documentId).filter((id): id is string => !!id)
      : []
  );
  const skillIds = conversation.messages.flatMap((message) =>
    Array.isArray(message.skills) ? (message.skills as unknown as SkillTag[]).map((skill) => skill.id) : []
  );
  const [documents, skills, source] = await Promise.all([
    ids.length ? db.document.findMany({ where: { userId, id: { in: ids } }, select: { id: true } }) : [],
    skillIds.length ? db.skill.findMany({ where: { userId, id: { in: skillIds } }, select: { id: true } }) : [],
    conversation.parentConversationId
      ? db.conversation.findFirst({ where: { id: conversation.parentConversationId, userId }, select: { id: true, title: true } })
      : null,
  ]);
  return { ...serializeConversation(conversation, {
    documents: new Set(documents.map((document) => document.id)),
    skills: new Set(skills.map((skill) => skill.id)),
  }), ...(source ? { forkSource: { id: source.id, title: source.title ?? undefined } } : {}) };
}
