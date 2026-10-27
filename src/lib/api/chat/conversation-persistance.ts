import { prisma } from '@/src/lib/prisma';
import { Role } from '@/src/types/chat.types';
import type { DocumentAttachment } from '@/src/types/chat.types';
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

export interface SavedMessage {
  id: string;
  role: Role;
  content: string;
  modelId?: string | null;
  attachments?: unknown;
  createdAt: Date;
}

/**
 * Save one exchange. `aiResponse` is empty when the model failed or the user
 * stopped it before any text arrived: then only the question is kept, which
 * matches what the client shows (the question and an error, no answer).
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
  skills: SkillTag[] = []
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
    ...(aiResponse
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

  await prisma.$transaction([
    prisma.message.createMany({ data: messages as unknown as Prisma.MessageCreateManyInput[] }),
    // Bump activity so the chat sorts by its latest message.
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: messages[messages.length - 1].createdAt } }),
  ]);

  return messages;
}

/**
 * Drop the last exchange (the question and the answer saved with it) so a retry
 * can save its replacement in that spot instead of appending a second copy.
 * Returns how many rows went away.
 */
export async function deleteLastExchange(conversationId: string): Promise<number> {
  const question = await prisma.message.findFirst({
    where: { conversationId, role: Role.User },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!question) return 0;

  // The exchange is the question plus anything saved after it (its answer,
  // or nothing at all when the model failed to answer).
  const { count } = await prisma.message.deleteMany({
    where: { conversationId, createdAt: { gte: question.createdAt } },
  });
  return count;
}
