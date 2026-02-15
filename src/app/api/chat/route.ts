import { NextRequest } from 'next/server';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { redisStore } from '@/src/lib/redis';
import crypto from 'crypto';
import { z } from 'zod';

import { incrementalProfileUpdate } from '@/src/services/profile/profiler';
import { runCouncilProcess } from '@/src/services/councilService';
import { ingestMessage } from '../../services/rag/ingest';
import { formatContextForLLM, retrieveContextWithFallback } from '@/src/services/retrievalService';
import { formatMessagesWithSystemContext } from '@/src/services/promptService';

const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(1000),
  selectedModel: z.string(),
});

enum Role {
  Assistant = 'assistant',
  User = 'user',
}

interface MessageType {
  role: Role;
  content: string;
  modelId?: string;
}

// Feature flag for RAG
const RAG_ENABLED = process.env.RAG_ENABLED === 'true';

// SSE Data types
interface SSEData {
  status?: string;
  chunk?: string;
  error?: string;
  conversationId?: string;
  done?: boolean;
  progress?: number;
  stage?: string;
  model?: string;
}

// OpenRouter API integration with system prompts
async function createCompletion(
  messages: Array<{ role: string; content: string }>,
  model: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  // Format messages with system context
  const formattedMessages = formatMessagesWithSystemContext(messages, model);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'ChatterStack',
    },
    body: JSON.stringify({
      model: model,
      messages: formattedMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body');
  }

  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();

        if (data === '[DONE]') {
          return fullContent;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;

          if (content) {
            fullContent += content;
            onChunk(content);
          }
        } catch {
          // Ignore invalid JSON chunks
        }
      }
    }
  }

  return fullContent;
}

// SSE streaming helper
function createSSEStream(
  onStream: (controller: ReadableStreamDefaultController) => Promise<void>
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await onStream(controller);
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
            })}\n\n`
          )
        );
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Helper to send SSE data
function sseData(controller: ReadableStreamDefaultController, data: SSEData) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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

    // Create SSE stream
    return createSSEStream(async (controller) => {
      sseData(controller, { status: 'starting' });

      // Load conversation history
      let conversationHistory = await redisStore.get(conversationId);

      if (conversationHistory.length === 0 && data.conversationId) {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId, userId },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        });

        if (conversation) {
          conversationHistory = conversation.messages.map((m) => ({
            role: m.role as Role,
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
        role: Role.User,
        content: data.message,
      });

      // RAG Context Retrieval
      let ragContext = '';
      if (RAG_ENABLED) {
        try {
          console.log('Retrieving RAG context...');
          const context = await retrieveContextWithFallback({
            userId,
            query: data.message,
            currentConversationId: conversationId,
            shortTermMessages: conversationHistory.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          });

          ragContext = formatContextForLLM(context);
          console.log(`RAG context: ${context.chunks.length} chunks retrieved`);
        } catch (error) {
          console.error('RAG retrieval failed:', error);
          // Continue without RAG context
        }
      }

      // Prepare messages for AI
      const messagesForAI = [
        ...conversationHistory,
        { role: Role.User, content: data.message },
      ].map((m) => ({
        role: m.role === Role.User ? 'user' : 'assistant',
        content: m.content,
      }));

      // Inject RAG context as a user message prefix (if available)
      if (ragContext && messagesForAI.length > 0) {
        const lastMessage = messagesForAI[messagesForAI.length - 1];
        if (lastMessage && lastMessage.role === 'user') {
          lastMessage.content = `Context from past conversations:\n\n${ragContext}\n\n---\n\nCurrent question: ${lastMessage.content}`;
        }
      }

      let fullContent = '';

      // Check if council mode
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
        // Regular single model response
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

      // Add AI response to cache
      if (fullContent) {
        await redisStore.add(conversationId, {
          role: Role.Assistant,
          content: fullContent,
          modelId:
            selectedModel === 'council'
              ? `council:google/gemini-3-pro-preview`
              : selectedModel,
        });
      }

      // Async RAG ingestion & profile update
      if (RAG_ENABLED && fullContent) {
        const userMessageId = crypto.randomUUID();
        const aiMessageId = crypto.randomUUID();

        // Ingest user message
        ingestMessage({
          userId,
          conversationId,
          messageId: userMessageId,
          content: data.message,
          role: 'user',
        }).catch((err) => console.error('User message ingestion failed:', err));

        // Ingest AI response
        ingestMessage({
          userId,
          conversationId,
          messageId: aiMessageId,
          content: fullContent,
          role: 'assistant',
          modelUsed:
            selectedModel === 'council'
              ? `council:google/gemini-3-pro-preview`
              : selectedModel,
        }).catch((err) => console.error('AI message ingestion failed:', err));

        // Update profile
        incrementalProfileUpdate(userId, {
          role: 'user',
          content: data.message,
        }).catch((err) => console.error('Profile update failed:', err));
      }

      // Persist to database
      if (!data.conversationId) {
        const userMessageTime = new Date();
        const aiMessageTime = new Date(userMessageTime.getTime() + 1);

        const conversation = await prisma.conversation.create({
          data: {
            id: conversationId,
            userId,
            messages: {
              create: [
                {
                  content: data.message,
                  role: Role.User,
                  createdAt: userMessageTime,
                },
                {
                  content: fullContent || 'Error generating response',
                  role: Role.Assistant,
                  modelId:
                    selectedModel === 'council'
                      ? `council:google/gemini-3-pro-preview`
                      : selectedModel,
                  createdAt: aiMessageTime,
                },
              ],
            },
          },
        });

        sseData(controller, { conversationId: conversation.id });
      } else {
        const userMessageTime = new Date();
        const aiMessageTime = new Date(userMessageTime.getTime() + 1);

        await prisma.message.createMany({
          data: [
            {
              conversationId,
              content: data.message,
              role: Role.User,
              createdAt: userMessageTime,
            },
            {
              conversationId,
              content: fullContent || 'Error generating response',
              role: Role.Assistant,
              modelId:
                selectedModel === 'council'
                  ? `council:google/gemini-3-pro-preview`
                  : selectedModel,
              createdAt: aiMessageTime,
            },
          ],
        });
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