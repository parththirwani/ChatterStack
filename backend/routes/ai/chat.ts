import { Router } from "express";
import { RedisStore } from "../../store/RedisStore";
import { CreateChatSchema, Role, SUPPORTED_MODELS } from "../../types";
import { createCompletion } from "../../openrouter";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authentication";
import crypto from "crypto";

import { CHAIRMAN_MODEL } from "../../config/council";
import { ingestMessage } from "../../services/rag/ingest";
import { retrieveContextWithFallback, formatContextForLLM } from "../../services/rag/retrieval";
import { incrementalProfileUpdate } from "../../services/profile/profiler";
import { runCouncilProcess } from "services/coucilService";

const router = Router();

// NEW: Feature flag for RAG
const RAG_ENABLED = process.env.RAG_ENABLED === 'true';

router.post("/", authenticate, async (req, res) => {
  try {
    console.log("=== Chat Request Debug ===");
    console.log("Request body:", req.body);
    console.log("User from token:", (req as any).user);

    const { success, data, error: validationError } = CreateChatSchema.safeParse(req.body);
    if (!success) {
      console.log("Validation failed:", validationError);
      return res.status(400).json({
        message: "Incorrect inputs",
        errors: validationError?.errors
      });
    }

    const userId = (req as any).user.id;
    const conversationId = data.conversationId ?? crypto.randomUUID();
    const selectedModel = data.selectedModel;

    console.log("Selected model for this request:", selectedModel);

    if (!SUPPORTED_MODELS.includes(selectedModel as any)) {
      return res.status(400).json({
        message: "Invalid model selected"
      });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "http://localhost:3001");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.flushHeaders();

    const store = RedisStore.getInstance();

    // Load conversation history
    let conversationHistory = await store.get(conversationId);
    console.log(`Redis cache: ${conversationHistory.length} messages found`);

    if (conversationHistory.length === 0 && data.conversationId) {
      console.log("Loading conversation history from database...");
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } }
      });

      if (!conversation) {
        console.log("Conversation not found or unauthorized");
        return res.status(404).json({ error: "Conversation not found" });
      }

      console.log(`Found ${conversation.messages.length} messages in database`);

      conversationHistory = conversation.messages.map((m) => ({
        role: m.role as Role,
        content: m.content,
        modelId: m.modelId ?? undefined,
      }));

      console.log("Repopulating Redis cache...");
      for (const msg of conversationHistory) {
        await store.add(conversationId, msg);
      }
      console.log("Redis cache repopulated");
    }

    // NEW: RAG Context Retrieval
    let ragContext = '';
    if (RAG_ENABLED) {
      try {
        console.log('Retrieving RAG context...');
        const context = await retrieveContextWithFallback({
          userId,
          query: data.message,
          currentConversationId: conversationId,
          shortTermMessages: conversationHistory.map(m => ({
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

    // Add new user message
    await store.add(conversationId, {
      role: Role.User,
      content: data.message,
    });

    // NEW: Prepare messages with RAG context
    const messagesForAI = [
      ...conversationHistory,
      { role: Role.User, content: data.message }
    ];

    // Inject RAG context as system message (if available)
    if (ragContext) {
      messagesForAI.unshift({
        role: Role.Assistant,
        content: `Context from user's past conversations:\n\n${ragContext}\n\nUse this context to provide more personalized and relevant responses.`
      });
    }

    console.log(`Sending to AI: ${messagesForAI.length} total messages (RAG: ${!!ragContext})`);

    res.write(`data: ${JSON.stringify({ status: "starting" })}\n\n`);

    let fullContent = "";
    const modelIdForDb = selectedModel === 'council' ? `council:${CHAIRMAN_MODEL}` : selectedModel;

    // Check if council mode
    if (selectedModel === 'council') {
      console.log('=== Using Council Mode ===');
      console.log(`Passing ${conversationHistory.length} messages as context`);

      try {
        fullContent = await runCouncilProcess(
          data.message,
          conversationHistory,
          (stage: string, model: string, progress: number) => {
            res.write(`data: ${JSON.stringify({
              status: "progress",
              stage,
              model,
              progress
            })}\n\n`);
          },
          (chunk: string) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        );
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        console.log('Council process complete');
      } catch (error) {
        console.error('Council process error:', error);
        res.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`);
      }
    } else {
      // Regular single model response
      try {
        fullContent = await createCompletion(
          messagesForAI,
          selectedModel,
          (chunk: string) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        );
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        console.log(`AI response complete for ${selectedModel}`);
      } catch (error) {
        console.error(`Error with model ${selectedModel}:`, error);
        res.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`);
      }
    }

    // Add AI response to Redis cache
    if (fullContent) {
      await store.add(conversationId, {
        role: Role.Assistant,
        content: fullContent,
        modelId: modelIdForDb,
      });
    }

    // NEW: Async RAG ingestion & profile update
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
      }).catch(err => console.error('User message ingestion failed:', err));

      // Ingest AI response
      ingestMessage({
        userId,
        conversationId,
        messageId: aiMessageId,
        content: fullContent,
        role: 'assistant',
        modelUsed: modelIdForDb,
      }).catch(err => console.error('AI message ingestion failed:', err));

      // Update profile
      incrementalProfileUpdate(userId, {
        role: 'user',
        content: data.message,
      }).catch(err => console.error('Profile update failed:', err));
    }

    // Persist to database
    if (!data.conversationId) {
      console.log("Creating new conversation in database");
      try {
        // Use explicit timestamps to ensure correct order
        const userMessageTime = new Date();
        const aiMessageTime = new Date(userMessageTime.getTime() + 1); // 1ms after user message

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
                  modelId: modelIdForDb,
                  createdAt: aiMessageTime,
                },
              ],
            },
          },
        });

        console.log("New conversation created:", conversation.id);
        res.write(
          `data: ${JSON.stringify({ conversationId: conversation.id })}\n\n`
        );
      } catch (dbError) {
        console.error("Database error creating conversation:", dbError);
        res.write(
          `data: ${JSON.stringify({ conversationId, warning: "Database save failed" })}\n\n`
        );
      }
    } else {
      console.log("Adding messages to existing conversation in database");
      try {
        // Use explicit timestamps to ensure correct order
        const userMessageTime = new Date();
        const aiMessageTime = new Date(userMessageTime.getTime() + 1); // 1ms after user message

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
              modelId: modelIdForDb,
              createdAt: aiMessageTime,
            },
          ],
        });
        console.log("Messages saved to database");
      } catch (dbError) {
        console.error("Database error saving messages:", dbError);
        res.write(
          `data: ${JSON.stringify({ warning: "Database save failed" })}\n\n`
        );
      }
    }

    console.log("=== Chat Request Complete ===");

    res.write("data: [DONE]\n\n");
    res.end();

  } catch (error) {
    console.error("Error in chat:", error);

    if (!res.writableEnded) {
      try {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (writeError) {
        console.error("Failed to write error response:", writeError);
        if (!res.writableEnded) {
          res.end();
        }
      }
    }
  }
});

export default router;