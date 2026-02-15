import { prisma } from '@/src/lib/prisma';
import { Role } from '@/src/types/chat.types';


export async function createNewConversation(
  conversationId: string,
  userId: string,
  userMessage: string,
  aiResponse: string,
  selectedModel: string
) {
  const userMessageTime = new Date();
  const aiMessageTime = new Date(userMessageTime.getTime() + 1);

  const conversation = await prisma.conversation.create({
    data: {
      id: conversationId,
      userId,
      messages: {
        create: [
          {
            content: userMessage,
            role: Role.User,
            createdAt: userMessageTime,
          },
          {
            content: aiResponse || 'Error generating response',
            role: Role.Assistant,
            modelId: selectedModel === 'council'
              ? `council:google/gemini-3-pro-preview`
              : selectedModel,
            createdAt: aiMessageTime,
          },
        ],
      },
    },
  });

  return conversation;
}

export async function addMessagesToConversation(
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  selectedModel: string
) {
  const userMessageTime = new Date();
  const aiMessageTime = new Date(userMessageTime.getTime() + 1);

  await prisma.message.createMany({
    data: [
      {
        conversationId,
        content: userMessage,
        role: Role.User,
        createdAt: userMessageTime,
      },
      {
        conversationId,
        content: aiResponse || 'Error generating response',
        role: Role.Assistant,
        modelId: selectedModel === 'council'
          ? `council:google/gemini-3-pro-preview`
          : selectedModel,
        createdAt: aiMessageTime,
      },
    ],
  });
}

export async function generateAndUpdateTitle(
  conversationId: string,
  userMessage: string,
  selectedModel: string
) {
  // Async title generation (don't block response)
  import('@/src/services/title/titleService')
    .then(({ generateConversationTitle, updateConversationTitle }) => {
      generateConversationTitle({ userMessage, modelId: selectedModel })
        .then((title) => updateConversationTitle(conversationId, title))
        .catch((err) => console.error('Title generation failed:', err));
    })
    .catch((err) => console.error('Failed to import title service:', err));
}