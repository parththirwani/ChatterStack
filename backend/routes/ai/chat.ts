// backend/routes/ai/chat.ts
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

    // Get selected models from request, default to all if none provided
    const selectedModels = data.selectedModels && data.selectedModels.length > 0
      ? data.selectedModels.filter(m => SUPPORTED_MODELS.includes(m as any))
      : SUPPORTED_MODELS;

    console.log("Selected models for this request:", selectedModels);

    if (selectedModels.length === 0) {
      return res.status(400).json({
        message: "At least one model must be selected"
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

    // Add new user message
    await store.add(conversationId, {
      role: Role.User,
      content: data.message,
    });

    const messagesForAI = [
      ...conversationHistory,
      { role: Role.User, content: data.message }
    ];

    console.log(`Sending to AI: ${messagesForAI.length} total messages`);

    res.write(`data: ${JSON.stringify({ status: "starting" })}\n\n`);

    // Get AI responses only from selected models
    const responses: Record<string, string> = {};
    await Promise.all(
      selectedModels.map(async (model) => {
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
          console.log(`AI response complete for ${model}`);
        } catch (error) {
          console.error(`Error with model ${model}:`, error);
          res.write(`data: ${JSON.stringify({ modelId: model, error: (error as Error).message })}\n\n`);
        }
      })
    );

    // Add AI responses to Redis cache
    for (const model of selectedModels) {
      if (responses[model]) {
        await store.add(conversationId, {
          role: Role.Assistant,
          content: responses[model],
          modelId: model,
        });
      }
    }

    // Persist to database
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
                ...selectedModels.map((model) => ({
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
            ...selectedModels.map((model) => ({
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