import { prisma } from '@/src/lib/prisma';
import { MESSAGE_ORDER_DESC, nextPosition } from '@/src/lib/server/message-order';
import { Role } from '@/src/types/chat.types';
import type { DocumentAttachment, MessageToolCallView } from '@/src/types/chat.types';
import type { SkillTag } from '@/src/types/skill.types';
import type { Prisma } from '@prisma/client';
import crypto from 'crypto';


/**
 * Create the conversation row as soon as a new chat starts, so it shows up in
 * the sidebar (and survives a reload) while the first answer is still streaming.
 * The title stays null until the title model names it.
 */
export async function createEmptyConversation(conversationId: string, userId: string) {
  return prisma.conversation.create({
    data: { id: conversationId, userId },
  });
}

/** First position that is free in this conversation, read inside its write. */
async function firstFreePosition(tx: Prisma.TransactionClient, conversationId: string) {
  const [highest, rows] = await Promise.all([
    tx.message.aggregate({ where: { conversationId }, _max: { position: true } }),
    tx.message.count({ where: { conversationId } }),
  ]);
  return nextPosition(highest._max.position, rows);
}

export interface SavedMessage {
  id: string;
  role: Role;
  content: string;
  modelId?: string | null;
  attachments?: unknown;
  createdAt: Date;
  position?: number;
}

/**
 * Save one exchange. `aiResponse` is empty when the model failed or the user
 * stopped it before any text arrived: then only the question is kept, which
 * matches what the client shows (the question and an error, no answer). A turn
 * that ran MCP tools always keeps its assistant row, even with no prose, so
 * the tool calls have a turn to belong to and the chat stays replayable.
 *
 * The rows keep their generated ids in the returned value, so the route can
 * cache the same ids that the compaction boundary later refers to.
 */
export async function addMessagesToConversation(
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  selectedModel: string,
  attachments: DocumentAttachment[] = [],
  skills: SkillTag[] = [],
  toolCalls: MessageToolCallView[] = []
): Promise<SavedMessage[]> {
  const userMessageTime = new Date();
  const aiMessageTime = new Date(userMessageTime.getTime() + 1);
  type MessageInput = SavedMessage & { conversationId: string; skills?: Prisma.InputJsonValue };
  const messages: MessageInput[] = [
    {
      id: crypto.randomUUID(),
      conversationId,
      content: userMessage,
      role: Role.User,
      attachments: attachments as unknown as Prisma.InputJsonValue,
      ...(skills.length ? { skills: skills as unknown as Prisma.InputJsonValue } : {}),
      createdAt: userMessageTime,
    },
    ...(aiResponse || toolCalls.length
      ? [{
          id: crypto.randomUUID(),
          conversationId,
          content: aiResponse,
          role: Role.Assistant,
          modelId: selectedModel,
          createdAt: aiMessageTime,
        }]
      : []),
  ];

  // The position is read in the same transaction as the insert, so two writes
  // can never hand the same row a position.
  await prisma.$transaction(async (tx) => {
    // Serialize position allocation across server instances. Reading MAX inside
    // a transaction alone still lets two writers choose the same position.
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId} FOR UPDATE`;
    const position = await firstFreePosition(tx, conversationId);
    messages.forEach((message, index) => { message.position = position + index; });
    await tx.message.createMany({ data: messages as unknown as Prisma.MessageCreateManyInput[] });
    if (toolCalls.length) {
      const assistant = messages.find((message) => message.role === Role.Assistant);
      if (assistant) {
        await tx.messageToolCall.createMany({
          data: toolCalls.map((call, index) => ({
            messageId: assistant.id,
            callId: call.callId,
            position: index,
            connectionId: call.connectionId,
            toolId: call.toolId,
            name: call.name,
            arguments: call.arguments,
            status: call.status,
            approval: call.approval,
            result: call.result,
            truncated: call.truncated,
            error: call.error ?? null,
          })),
        });
      }
    }
    // Bump activity so the chat sorts by its latest message.
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: messages[messages.length - 1].createdAt } });
  });

  return messages;
}

/**
 * Drop the last exchange (the question and the answer saved with it) so a retry
 * can save its replacement in that spot instead of appending a second copy.
 * The saved MCP tool calls go with the answer row through its cascade.
 * Returns how many rows went away.
 */
export async function deleteLastExchange(conversationId: string): Promise<number> {
  const question = await prisma.message.findFirst({
    where: { conversationId, role: Role.User },
    orderBy: MESSAGE_ORDER_DESC,
    select: { position: true, createdAt: true },
  });
  if (!question) return 0;

  // The exchange is the question plus everything ordered after it (its answer,
  // or nothing at all when the model failed to answer). A question saved before
  // positions existed still falls back to its timestamp.
  const position = question.position ?? null;
  const { count } = await prisma.message.deleteMany({
    where: {
      conversationId,
      ...(position !== null ? { position: { gte: position } } : { createdAt: { gte: question.createdAt } }),
    },
  });
  return count;
}
