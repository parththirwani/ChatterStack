import { prisma } from '@/src/lib/prisma';
import { Role } from '@/src/types/chat.types';
import type { ChatAttachment } from '@/src/types/chat.types';
import type { Prisma } from '@prisma/client';


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
  attachments: ChatAttachment[] = []
) {
  const userMessageTime = new Date();
  const aiMessageTime = new Date(userMessageTime.getTime() + 1);
  const messages = [
    { conversationId, content: userMessage, role: Role.User, attachments: attachments as unknown as Prisma.InputJsonValue, createdAt: userMessageTime },
    ...(aiResponse
      ? [{ conversationId, content: aiResponse, role: Role.Assistant, modelId: selectedModel, createdAt: aiMessageTime }]
      : []),
  ];

  await prisma.$transaction([
    prisma.message.createMany({ data: messages }),
    // Bump activity so the chat sorts by its latest message.
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: messages[messages.length - 1].createdAt } }),
  ]);
}
