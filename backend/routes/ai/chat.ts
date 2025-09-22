// backend/routes/chat.ts
import { Router } from "express";
import { InMemoryStore } from "../../store/InMemoryStore";
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
    console.log("Headers:", req.headers);
    console.log("Cookies:", req.cookies);

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
    console.log("Models:", SUPPORTED_MODELS);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "http://localhost:3001");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.flushHeaders();

    let existingMessages = InMemoryStore.getInstance().get(conversationId);

    if (existingMessages.length === 0 && data.conversationId) {
      console.log("Loading messages from DB for conversation:", conversationId);

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } }
      });

      if (!conversation) {
        console.log("Conversation not found or unauthorized");
        return res.status(404).json({ error: "Conversation not found" });
      }

      console.log("Found DB messages:", conversation.messages.length);
      existingMessages = conversation.messages.map((m) => ({
        role: m.role as Role,
        content: m.content,
        modelId: m.modelId ?? undefined, // Changed from model to modelId
      }));

      for (const msg of existingMessages) {
        InMemoryStore.getInstance().add(conversationId, msg);
      }
    }

    console.log("Total messages in conversation:", existingMessages.length + 1);

    const messagesForAI = [...existingMessages, { role: Role.User, content: data.message }];
    console.log("Sending to AI:", messagesForAI.map(m => ({
      role: m.role,
      content: m.content.substring(0, 50) + (m.content.length > 50 ? "..." : "")
    })));

    res.write(`data: ${JSON.stringify({ status: "starting" })}\n\n`);

    InMemoryStore.getInstance().add(conversationId, {
      role: Role.User,
      content: data.message,
    });

    const responses: Record<string, string> = {};
    await Promise.all(
      SUPPORTED_MODELS.map(async (model) => {
        try {
          const fullContent = await createCompletion(
            messagesForAI,
            model,
            (chunk: string) => {
              res.write(`data: ${JSON.stringify({ modelId: model, chunk })}\n\n`); // Changed model to modelId
            }
          );
          responses[model] = fullContent;
          res.write(`data: ${JSON.stringify({ modelId: model, done: true })}\n\n`); // Changed model to modelId
          console.log(`AI response complete for ${model}, length:`, fullContent.length);
        } catch (error) {
          console.error(`Error with model ${model}:`, error);
          res.write(`data: ${JSON.stringify({ modelId: model, error: (error as Error).message })}\n\n`); // Changed model to modelId
        }
      })
    );

    SUPPORTED_MODELS.forEach((model) => {
      if (responses[model]) {
        InMemoryStore.getInstance().add(conversationId, {
          role: Role.Assistant,
          content: responses[model],
          modelId: model, // Changed from model to modelId
        });
      }
    });

    if (!data.conversationId) {
      console.log("Creating new conversation in DB");

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
                  modelId: model, // Changed from model to modelId
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
      console.log("Adding messages to existing conversation");

      try {
        await prisma.message.createMany({
          data: [
            { conversationId, content: data.message, role: Role.User },
            ...SUPPORTED_MODELS.map((model) => ({
              conversationId,
              content: responses[model] || "Error generating response",
              role: Role.Assistant,
              modelId: model, // Changed from model to modelId
            })),
          ],
        });
        console.log("Messages saved to DB");
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