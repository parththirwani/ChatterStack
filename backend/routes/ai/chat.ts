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

    // Get selected model from request
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

    // Get AI response from single selected model
    let fullContent = "";
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

    // Add AI response to Redis cache
    if (fullContent) {
      await store.add(conversationId, {
        role: Role.Assistant,
        content: fullContent,
        modelId: selectedModel,
      });
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
                {
                  content: fullContent || "Error generating response",
                  role: Role.Assistant,
                  modelId: selectedModel,
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
        await prisma.message.createMany({
          data: [
            { conversationId, content: data.message, role: Role.User },
            {
              conversationId,
              content: fullContent || "Error generating response",
              role: Role.Assistant,
              modelId: selectedModel,
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