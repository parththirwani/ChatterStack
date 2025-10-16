// backend/routes/chat.ts
import { Router } from "express";
import { RedisStore } from "../../store/RedisStore";
import { CreateChatSchema, Role, SUPPORTED_MODELS } from "../../types";
import { createCompletion } from "../../openrouter";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authentication";
import crypto from "crypto";

const router = Router();

router.post("/", authenticate, async (req, res) => {
  try {
    console.log("=== Environment Debug ===");
    console.log("OPENROUTER_API_KEY exists:", !!process.env.OPENROUTER_API_KEY);
    console.log("OPENROUTER_API_KEY value:", process.env.OPENROUTER_API_KEY?.substring(0, 10) + "...");
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
    console.log("Using user ID:", userId);

    const conversationId = data.conversationId ?? crypto.randomUUID();
    console.log("Conversation ID:", conversationId);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "http://localhost:3001");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.flushHeaders();

    const store = RedisStore.getInstance();

    // Step 1: Try to get messages from Redis
    let conversationHistory = await store.get(conversationId);
    console.log(`Redis cache: ${conversationHistory.length} messages found`);

    // Step 2: If Redis is empty and this is an existing conversation, load from DB
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
      
      // Map DB messages to Message format
      conversationHistory = conversation.messages.map((m) => ({
        role: m.role as Role,
        content: m.content,
        modelId: m.modelId ?? undefined,
      }));

      // Step 3: Repopulate Redis cache with conversation history
      console.log("Repopulating Redis cache...");
      for (const msg of conversationHistory) {
        await store.add(conversationId, msg);
      }
      console.log("Redis cache repopulated");
    }

    // Step 4: Add the new user message to Redis cache
    await store.add(conversationId, {
      role: Role.User,
      content: data.message,
    });

    // Step 5: Build message array for AI (includes history + new message)
    const messagesForAI = [
      ...conversationHistory,
      { role: Role.User, content: data.message }
    ];

    console.log(`Sending to AI: ${messagesForAI.length} total messages (${conversationHistory.length} from history + 1 new)`);
    console.log("Message preview:", messagesForAI.map(m => ({
      role: m.role,
      content: m.content.substring(0, 50) + (m.content.length > 50 ? "..." : ""),
      modelId: m.modelId
    })));

    res.write(`data: ${JSON.stringify({ status: "starting" })}\n\n`);

    // Step 6: Get AI responses
    const responses: Record<string, string> = {};
    await Promise.all(
      SUPPORTED_MODELS.map(async (model) => {
        try {
          const fullContent = await createCompletion(
            messagesForAI,
            model,
            (chunk: string) => {
              res.write(`data: ${JSON.stringify({ modelId: model, chunk })}\n\n`);
            }
          );
          responses[model] = fullContent;
          res.write(`data: ${JSON.stringify({ modelId: model, done: true })}\n\n`);
          console.log(`AI response complete for ${model}, length:`, fullContent.length);
        } catch (error) {
          console.error(`Error with model ${model}:`, error);
          res.write(`data: ${JSON.stringify({ modelId: model, error: (error as Error).message })}\n\n`);
        }
      })
    );

    // Step 7: Add AI responses to Redis cache
    for (const model of SUPPORTED_MODELS) {
      if (responses[model]) {
        await store.add(conversationId, {
          role: Role.Assistant,
          content: responses[model],
          modelId: model,
        });
      }
    }

    // Step 8: Persist to database
    if (!data.conversationId) {
      console.log("Creating new conversation in database");

      try {
        const conversation = await prisma.conversation.create({
          data: {
            id: conversationId,
            userId,
            messages: {
              create: [
                { content: data.message, role: Role.User },
                ...SUPPORTED_MODELS.map((model) => ({
                  content: responses[model] || "Error generating response",
                  role: Role.Assistant,
                  modelId: model,
                })),
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
        await prisma.message.createMany({
          data: [
            { conversationId, content: data.message, role: Role.User },
            ...SUPPORTED_MODELS.map((model) => ({
              conversationId,
              content: responses[model] || "Error generating response",
              role: Role.Assistant,
              modelId: model,
            })),
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
