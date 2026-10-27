import { prisma } from '@/src/lib/prisma';
import { MESSAGE_ORDER_DESC, nextPosition } from '@/src/lib/server/message-order';
import { Role } from '@/src/types/chat.types';
import type { DocumentAttachment } from '@/src/types/chat.types';
import type { SkillTag } from '@/src/types/skill.types';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';


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

/**
 * Save one exchange. `aiResponse` is empty when the model failed or the user
 * stopped it before any text arrived: then only the question is kept, which
 * matches what the client shows (the question and an error, no answer).
 */
export async function addMessagesToConversation(
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  selectedModel: string,
  attachments: DocumentAttachment[] = [],
  skills: SkillTag[] = []
) {
  const userMessageTime = new Date();
  const aiMessageTime = new Date(userMessageTime.getTime() + 1);
  const userMessageId = randomUUID();
  const assistantMessageId = aiResponse ? randomUUID() : undefined;
  const messages = [
    { id: userMessageId, conversationId, content: userMessage, role: Role.User, attachments: attachments as unknown as Prisma.InputJsonValue, ...(skills.length ? { skills: skills as unknown as Prisma.InputJsonValue } : {}), createdAt: userMessageTime },
    ...(aiResponse
      ? [{ id: assistantMessageId!, conversationId, content: aiResponse, role: Role.Assistant, modelId: selectedModel, createdAt: aiMessageTime }]
      : []),
  ];

  // The position is read in the same transaction as the insert, so two writes
  // can never hand the same row a position.
  await prisma.$transaction(async (tx) => {
    // Serialize position allocation across server instances. Reading MAX inside
    // a transaction alone still lets two writers choose the same position.
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId} FOR UPDATE`;
    const position = await firstFreePosition(tx, conversationId);
    await tx.message.createMany({ data: messages.map((message, index) => ({ ...message, position: position + index })) });
    // Bump activity so the chat sorts by its latest message.
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: messages[messages.length - 1].createdAt } });
  });
  return { userMessageId, assistantMessageId };
}

/**
 * Drop the last exchange (the question and the answer saved with it) so a retry
 * can save its replacement in that spot instead of appending a second copy.
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
