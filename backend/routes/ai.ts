import { Router } from "express";
import { InMemoryStore } from "../store/InMemoryStore";
import { CreateChatSchema, Role } from "../types";
import { createCompletion } from "openrouter";
import { prisma } from "../lib/prisma";
import { authenticate } from "middleware/authentication";


const router = Router();

router.get("/conversations", authenticate, async (req, res) => {
    const userId = (req as any).user.id;
    const conversations = await prisma.conversation.findMany({
        where: {
            userId
        },
        include: {
            messages: true
        }
    })
    res.json(conversations)
})

router.get("/conversations/:conversationId", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const conversationId = req.params.conversationId;

    console.log("Fetching conversation:", { userId, conversationId });

    if (!conversationId) {
      console.error("Missing conversationId in request params");
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
        userId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    console.log("Conversation from DB:", conversation);

    if (!conversation) {
      console.warn("Conversation not found:", { userId, conversationId });
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Generate title if not already present
    let title = conversation.title;
    if (!title) {
      console.log("Title missing, generating one...");
      const { TitleService } = await import("../services/titleService");
      title = await TitleService.generateTitle(conversationId);
      console.log("Generated title:", title);
    }

    res.json({
      conversation: {
        ...conversation,
        title,
      },
    });
  } catch (err) {
    console.error("Error fetching conversation:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



router.post("/chat", authenticate, async (req, res) => {
    try {
        const { success, data } = CreateChatSchema.safeParse(req.body);
        if (!success) {
            return res.status(411).json({ message: "Incorrect inputs" });
        }

        const userId = (req as any).user.id;
        const conversationId = data?.conversationId ?? crypto.randomUUID();

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.flushHeaders();

        let message = "";
        let existingMessages = InMemoryStore.getInstance().get(conversationId);

        await createCompletion(
            [...existingMessages, { role: Role.User, content: data.message }],
            data.model,
            (chunk: string) => {
                message += chunk;
                res.write(chunk);
            }
        );
        res.end();

        // Save in memory using turns (turn: user message + assistant message)
        InMemoryStore.getInstance().add(conversationId, {
            role: Role.User,
            content: data.message,
        });
        InMemoryStore.getInstance().add(conversationId, {
            role: Role.Assistant,
            content: message,
        });

        // Save in DB

        if (!data.conversationId) {
            await prisma.conversation.create({
                data: {
                    userId,
                    messages: {
                        create: [
                            {
                                content: data.message,
                                role: Role.User,
                            },
                            {
                                content: message,
                                role: Role.Assistant
                            }
                        ]
                    }
                }
            })
        } else {

            await prisma.message.createMany({
                data: [
                    {
                        conversationId,
                        content: message,
                        role: Role.Assistant,
                    },
                    {
                        conversationId,
                        content: data.message,
                        role: Role.User
                    }
                ]
            })
        }

    } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
