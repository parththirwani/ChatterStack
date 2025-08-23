import { Router } from "express";

import { InMemoryStore } from "../store/InMemoryStore";
import { CreateChatSchema, Role } from "../types";
import { createCompletion } from "openrouter";
import { PrismaClient } from "@prisma/client/extension";
import { prisma } from "lib/prisma";


const router = Router();

router.post("/chat", async (req, res) => {
    try {
        const { success, data } = CreateChatSchema.safeParse(req.body);

        const conversationId = data?.conversationId ?? crypto.randomUUID();
        if (!success) {
            res.status(411).json({
                message: "Incorrect inputs"
            });
            return;
        }

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform"); // no proxy caching or compression
        res.setHeader("Connection", "keep-alive"); // keep connection open
        res.setHeader("X-Accel-Buffering", "no"); // disable buffering in nginx/proxies
        res.setHeader("Access-Control-Allow-Origin", "*"); // CORS for frontend
        res.flushHeaders();
        
        let message = "";
        let existingMessages = InMemoryStore.getInstance().get(conversationId);

        // EventEmitters
        await createCompletion([...existingMessages, {
            role: Role.User,
            content: data.message
        }], data.model,
            (chunk: string) => {
                message += chunk;
                res.write(chunk);
            });
        res.end();

        // Storing one turn of messages per request in the db (turn: one user message + one assistant message)
        InMemoryStore.getInstance().add(conversationId, {
            role: Role.User,
            content: data.message
        });

        InMemoryStore.getInstance().add(conversationId, {
            role: Role.Assistant,
            content: message
        });

        await prisma.conversation

    } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;