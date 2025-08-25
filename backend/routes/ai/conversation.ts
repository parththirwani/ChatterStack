import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authentication";

const router = Router();

// GET all conversations
router.get("/", authenticate, async (req, res) => {
  const userId = (req as any).user.id;
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    include: { messages: true },
  });
  res.json(conversations);
});

// GET single conversation
router.get("/:conversationId", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const conversationId = req.params.conversationId;

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    let title = conversation.title;
    if (!title) {
      const { TitleService } = await import("../../services/titleService");
      title = await TitleService.generateTitle(conversationId);
    }

    res.json({ conversation: { ...conversation, title } });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
