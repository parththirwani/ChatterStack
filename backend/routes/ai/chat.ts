import { Router } from "express";
import { InMemoryStore } from "../../store/InMemoryStore";
import { CreateChatSchema, Role } from "../../types";
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

    // 👇 If client provides conversationId, reuse it; else generate new
    const conversationId = data.conversationId ?? crypto.randomUUID();
    console.log("Conversation ID:", conversationId);
    console.log("Model:", data.model);

    // SSE headers - Fixed CORS for frontend
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "http://localhost:3001");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.flushHeaders();

    let message = "";
    let existingMessages = InMemoryStore.getInstance().get(conversationId);

    // 👇 Hydrate from DB if memory empty but conversationId exists
    if (existingMessages.length === 0 && data.conversationId) {
      console.log("Loading messages from DB for conversation:", conversationId);

      // Verify conversation belongs to user
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
      }));

      for (const msg of existingMessages) {
        InMemoryStore.getInstance().add(conversationId, msg);
      }
    }

    console.log("Total messages in conversation:", existingMessages.length + 1);

    // 👇 Generate reply with history
    const messagesForAI = [...existingMessages, { role: Role.User, content: data.message }];
    console.log("Sending to AI:", messagesForAI.map(m => ({
      role: m.role,
      content: m.content.substring(0, 50) + (m.content.length > 50 ? "..." : "")
    })));

    // Send initial confirmation that request was received
    res.write(`data: ${JSON.stringify({ status: "starting" })}\n\n`);

    await createCompletion(
      messagesForAI,
      data.model || "openai/gpt-4o-mini",
      (chunk: string) => {
        message += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    );

    console.log("AI response complete, length:", message.length);

    // 👇 Add messages to in-memory store
    InMemoryStore.getInstance().add(conversationId, {
      role: Role.User,
      content: data.message,
    });
    InMemoryStore.getInstance().add(conversationId, {
      role: Role.Assistant,
      content: message,
    });

    if (!data.conversationId) {
      // 👇 New conversation
      console.log("Creating new conversation in DB");

      try {
        const conversation = await prisma.conversation.create({
          data: {
            id: conversationId,
            userId,
            messages: {
              create: [
                { content: data.message, role: Role.User },
                { content: message, role: Role.Assistant },
              ],
            },
          },
        });

        console.log("New conversation created:", conversation.id);
        // send conversationId to client
        res.write(
          `data: ${JSON.stringify({ conversationId: conversation.id })}\n\n`
        );
      } catch (dbError) {
        console.error("Database error creating conversation:", dbError);
        // Continue anyway - we have the messages in memory
        res.write(
          `data: ${JSON.stringify({ conversationId, warning: "Database save failed" })}\n\n`
        );
      }
    } else {
      // 👇 Existing conversation
      console.log("Adding messages to existing conversation");

      try {
        await prisma.message.createMany({
          data: [
            { conversationId, content: data.message, role: Role.User },
            { conversationId, content: message, role: Role.Assistant },
          ],
        });
        console.log("Messages saved to DB");
      } catch (dbError) {
        console.error("Database error saving messages:", dbError);
        // Continue anyway - we have the messages in memory
        res.write(
          `data: ${JSON.stringify({ warning: "Database save failed" })}\n\n`
        );
      }
    }

    console.log("=== Chat Request Complete ===");

    // 👇 End SSE stream properly
    res.write("data: [DONE]\n\n");
    res.end();

  } catch (error) {
    console.error("Error in chat:", error);

    // Send error to client via SSE
    if (!res.writableEnded) {
      try {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (writeError) {
        console.error("Failed to write error response:", writeError);
        // Force end the response
        if (!res.writableEnded) {
          res.end();
        }
      }
    }
  }
});

export default router;