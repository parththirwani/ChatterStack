import { prisma } from '@/src/lib/prisma';
import type { Conversation } from '@/src/types/conversation.types';
import type { Message } from '@/src/types/chat.types';
import type { AttachmentMeta } from '@/src/types/chat.types';
import type { SkillTag } from '@/src/types/skill.types';

/**
 * The one place conversations are read and shaped for the client, shared by
 * the server render (chat-data.ts) and the /api/conversations routes so both
 * hydration paths see identical data.
 */

interface MessageRow {
  id: string;
  role: string;
  content: string | null;
  modelId: string | null;
  attachments?: unknown;
  skills?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationRow {
  id: string;
  title: string | null;
  pinnedAt: Date | null;
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

function serializeMessage(message: MessageRow, present?: Present): Message {
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
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function serializeConversation(conversation: ConversationRow, present?: Present): Conversation {
  return {
    id: conversation.id,
    title: conversation.title ?? undefined,
    pinnedAt: conversation.pinnedAt?.toISOString() ?? null,
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
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 1, select: {
      id: true, role: true, content: true, modelId: true, createdAt: true, updatedAt: true,
    } } },
    orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: limit,
    skip: offset,
  });
  return conversations.map((conversation) => serializeConversation(conversation));
}

/** One conversation with all its messages, or null if it isn't this user's. */
export async function getConversation(userId: string, conversationId: string): Promise<Conversation | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
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
  const [documents, skills] = await Promise.all([
    ids.length ? prisma.document.findMany({ where: { userId, id: { in: ids } }, select: { id: true } }) : [],
    skillIds.length ? prisma.skill.findMany({ where: { userId, id: { in: skillIds } }, select: { id: true } }) : [],
  ]);
  return serializeConversation(conversation, {
    documents: new Set(documents.map((document) => document.id)),
    skills: new Set(skills.map((skill) => skill.id)),
  });
}
