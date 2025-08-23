import { Router } from "express";
import { InMemoryStore } from "../store/InMemoryStore";
import { CreateChatSchema, Role } from "../types";
import { createCompletion } from "openrouter";
import { prisma } from "../lib/prisma";
import { authenticate } from "middleware/auth";


const router = Router();

router.get("/conversations",authenticate, async(req,res)=>{
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

router.get("/conversations/:conversationId", authenticate, async(req,res)=>{
        const userId = (req as any).user.id;
        const conservationId = req.params.conversationId;
        const conversation = await prisma.conversation.findUnique({
            where: {
                id: conservationId,
                userId
            },
            include: {
                messages: {
                    orderBy: {
                        createdAt: "asc"
                    }
                }
            }
        })
        res.json({
            conversation
        })
})

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
