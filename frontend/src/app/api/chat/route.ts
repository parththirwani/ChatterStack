import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@src/lib/prisma";
import { redisStore } from "@src/lib/redis";
import crypto from "crypto";
import { z } from "zod";
import { auth } from "@/src/lib/auth";

const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(1000),
  selectedModel: z.string(),
});

enum Role {
  Assistant = "assistant",
  User = "user",
}

interface Message {
  role: Role;
  content: string;
  modelId?: string;
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
            `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" })}\n\n`
          )
        );
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Helper to send SSE data
function sseData(controller: ReadableStreamDefaultController, data: any) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();

    const { success, data, error: validationError } = ChatRequestSchema.safeParse(body);
    if (!success) {
      return NextResponse.json(
        {
          message: "Incorrect inputs",
          errors: validationError?.errors,
        },
        { status: 400 }
      );
    }

    const conversationId = data.conversationId ?? crypto.randomUUID();
    const selectedModel = data.selectedModel;

    // Create SSE stream
    return createSSEStream(async (controller) => {
      sseData(controller, { status: "starting" });

      // Load conversation history
      let conversationHistory = await redisStore.get(conversationId);

      if (conversationHistory.length === 0 && data.conversationId) {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId, userId },
          include: { messages: { orderBy: { createdAt: "asc" } } },
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

      // Prepare messages for AI
      const messagesForAI = [
        ...conversationHistory,
        { role: Role.User, content: data.message },
      ];

      let fullContent = "";

      // Call AI service (you'll need to implement this)
      // For now, this is a placeholder
      const { createCompletion } = await import("@/lib/ai");
      
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
        sseData(controller, { error: (error as Error).message });
      }

      // Add AI response to cache
      if (fullContent) {
        await redisStore.add(conversationId, {
          role: Role.Assistant,
          content: fullContent,
          modelId: selectedModel,
        });
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
                  content: fullContent || "Error generating response",
                  role: Role.Assistant,
                  modelId: selectedModel,
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
              content: fullContent || "Error generating response",
              role: Role.Assistant,
              modelId: selectedModel,
              createdAt: aiMessageTime,
            },
          ],
        });
      }
    });
  } catch (error) {
    console.error("Error in chat:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error occurred" },
      { status: 500 }
    );
  }
}