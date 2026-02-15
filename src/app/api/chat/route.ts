import { NextRequest } from 'next/server';
import { auth } from '@/src/lib/auth';
import { redisStore } from '@/src/lib/redis';
import crypto from 'crypto';
import { runCouncilProcess } from '@/src/services/council/councilService';
import { createNewConversation, generateAndUpdateTitle, addMessagesToConversation } from '@/src/lib/api/chat/conversation-persistance';
import { createCompletion } from '@/src/lib/api/chat/openrouter';
import { retrieveRAGContext, ingestConversationData } from '@/src/lib/api/chat/rag-integration';
import { createSSEStream, sseData } from '@/src/lib/api/chat/sse-helper';

import { withLLMTokenLimit, recordLLMTokens, countTokens } from '@/src/middleware/llmTokenRateLimit';
import { ChatRequestSchema } from '@/src/types/chat.types';

interface RedisMessage {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userId = session.user.id;
    const body = await request.json();

    const { success, data, error: validationError } =
      ChatRequestSchema.safeParse(body);
    if (!success) {
      return new Response(
        JSON.stringify({
          message: 'Incorrect inputs',
          errors: validationError?.issues,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const conversationId = data.conversationId ?? crypto.randomUUID();
    const selectedModel = data.selectedModel;
    const isCouncilMode = selectedModel === 'council';

    const rateLimitCheck = await withLLMTokenLimit(
      userId,
      data.message,
      isCouncilMode
    );
    if (rateLimitCheck) {
      return rateLimitCheck; // Returns 429 with detailed token info
    }
    // End rate limiting check

    // Create SSE stream
    return createSSEStream(async (controller) => {
      sseData(controller, { status: 'starting' });

      // Load conversation history
      let conversationHistory: RedisMessage[] = await redisStore.get(conversationId);

      if (conversationHistory.length === 0 && data.conversationId) {
        const { prisma } = await import('@/src/lib/prisma');
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId, userId },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        });

        if (conversation) {
          conversationHistory = conversation.messages.map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
            modelId: m.modelId ?? undefined,
          }));

          for (const msg of conversationHistory) {
            await redisStore.add(conversationId, msg);
          }
        }
      }

      // Add user message
      await redisStore.add(conversationId, {
        role: 'user' as const,
        content: data.message,
      });

      // RAG Context Retrieval
      const ragContext = await retrieveRAGContext(
        userId,
        data.message,
        conversationId,
        conversationHistory
      );

      // Prepare messages for AI
      const messagesForAI = [
        ...conversationHistory,
        { role: 'user' as const, content: data.message },
      ].map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));

      // Inject RAG context if available
      if (ragContext && messagesForAI.length > 0) {
        const lastMessage = messagesForAI[messagesForAI.length - 1];
        if (lastMessage && lastMessage.role === 'user') {
          lastMessage.content = `Context from past conversations:\n\n${ragContext}\n\n---\n\nCurrent question: ${lastMessage.content}`;
        }
      }

      let fullContent = '';

      // Council mode vs Regular mode
      if (selectedModel === 'council') {
        try {
          fullContent = await runCouncilProcess(
            data.message,
            conversationHistory,
            (stage: string, model: string, progress: number) => {
              sseData(controller, {
                status: 'progress',
                stage,
                model,
                progress,
              });
            },
            (chunk: string) => {
              sseData(controller, { chunk });
            }
          );

          sseData(controller, { done: true });
        } catch (error) {
          sseData(controller, {
            error: error instanceof Error ? error.message : 'Council process failed',
          });
        }
      } else {
        try {
          fullContent = await createCompletion(
            messagesForAI,
            selectedModel,
            (chunk: string) => {
              sseData(controller, { chunk });
            }
          );

          sseData(controller, { done: true });
        } catch (error) {
          sseData(controller, {
            error:
              error instanceof Error ? error.message : 'Failed to generate response',
          });
        }
      }

      if (fullContent) {
        try {
          // Count input tokens (user message + context)
          const inputText = messagesForAI.map(m => m.content).join('\n');
          const inputTokens = countTokens(inputText);
          
          // Count output tokens (AI response)
          const outputTokens = countTokens(fullContent);
          
          // Total tokens used
          const totalTokens = inputTokens + outputTokens;
          
          // Record for rate limiting
          await recordLLMTokens(userId, totalTokens, isCouncilMode);
          
          console.log(`[RateLimit] User ${userId}: ${totalTokens} tokens (${inputTokens} in + ${outputTokens} out)`);
        } catch (error) {
          console.error('Failed to record tokens:', error);
          // Don't fail the request if token recording fails
        }
      }

      if (fullContent) {
        await redisStore.add(conversationId, {
          role: 'assistant' as const,
          content: fullContent,
          modelId:
            selectedModel === 'council'
              ? `council:google/gemini-3-pro-preview`
              : selectedModel,
        });
      }
      await ingestConversationData(
        userId,
        conversationId,
        data.message,
        fullContent,
        selectedModel
      );

      // Persist to database
      if (!data.conversationId) {
        const conversation = await createNewConversation(
          conversationId,
          userId,
          data.message,
          fullContent,
          selectedModel
        );

        sseData(controller, { conversationId: conversation.id });

        // Generate title asynchronously
        generateAndUpdateTitle(conversationId, data.message, selectedModel);
      } else {
        await addMessagesToConversation(
          conversationId,
          data.message,
          fullContent,
          selectedModel
        );
      }
    });
  } catch (error) {
    console.error('Error in chat:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}