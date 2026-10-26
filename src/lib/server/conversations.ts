import { prisma } from '@/src/lib/prisma';
import type { Conversation } from '@/src/types/conversation.types';
import type { Message } from '@/src/types/chat.types';
import type { AttachmentMeta } from '@/src/types/chat.types';

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

function serializeMessage(message: MessageRow, presentDocuments?: Set<string>): Message {
  return {
    id: message.id,
    role: message.role as Message['role'],
    content: message.content ?? '',
    modelId: message.modelId ?? undefined,
    attachments: Array.isArray(message.attachments)
      ? (message.attachments as AttachmentMeta[]).map(({ documentId, name, mimeType, size }) => ({
        documentId, name, mimeType, size, removed: !!documentId && !!presentDocuments && !presentDocuments.has(documentId),
      }))
      : undefined,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function serializeConversation(conversation: ConversationRow, presentDocuments?: Set<string>): Conversation {
  return {
    id: conversation.id,
    title: conversation.title ?? undefined,
    pinnedAt: conversation.pinnedAt?.toISOString() ?? null,
    userId: conversation.userId,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages: conversation.messages.map((message) => serializeMessage(message, presentDocuments)),
  };
}

/** The sidebar list: pinned first (most recently pinned on top), then by activity, each with its first message. */
export async function listConversations(
  userId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<Conversation[]> {
  const conversations = await prisma.conversation.findMany({
    where: { userId },
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
  const documents = ids.length ? await prisma.document.findMany({
    where: { userId, id: { in: ids } }, select: { id: true },
  }) : [];
  return serializeConversation(conversation, new Set(documents.map((document) => document.id)));
}
