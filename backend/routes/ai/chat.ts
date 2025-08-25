import { Router } from "express";
import { InMemoryStore } from "../../store/InMemoryStore";
import { CreateChatSchema, Role } from "../../types";
import { createCompletion } from "openrouter";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authentication";
import crypto from "crypto";

const router = Router();

router.post("/", authenticate, async (req, res) => {
  try {
    const { success, data } = CreateChatSchema.safeParse(req.body);
    if (!success) return res.status(411).json({ message: "Incorrect inputs" });

    const userId = (req as any).user.id;

    // 👇 If client provides conversationId, reuse it; else generate new
    const conversationId = data.conversationId ?? crypto.randomUUID();

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    let message = "";
    let existingMessages = InMemoryStore.getInstance().get(conversationId);

    // 👇 Hydrate from DB if memory empty but conversationId exists
    if (existingMessages.length === 0 && data.conversationId) {
      const dbMessages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
      });

      existingMessages = dbMessages.map((m) => ({
        role: m.role as Role,
        content: m.content,
      }));

      for (const msg of existingMessages) {
        InMemoryStore.getInstance().add(conversationId, msg);
      }
    }

    // 👇 Generate reply with history
    await createCompletion(
      [...existingMessages, { role: Role.User, content: data.message }],
      data.model,
      (chunk: string) => {
        message += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    );

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

      // send conversationId to client
      res.write(
        `data: ${JSON.stringify({ conversationId: conversation.id })}\n\n`
      );
    } else {
      // 👇 Existing conversation
      await prisma.message.createMany({
        data: [
          { conversationId, content: data.message, role: Role.User },
          { conversationId, content: message, role: Role.Assistant },
        ],
      });
    }

    // 👇 End SSE stream properly
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Error in chat:", error);
    if (!res.writableEnded) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
