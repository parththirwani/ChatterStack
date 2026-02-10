import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authentication";

const router = Router();

// GET all conversations
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    console.log("Getting conversations for user:", userId);
    
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: { 
        messages: { 
          orderBy: { createdAt: "asc" }, // Ensure chronological order
          select: {
            id: true,
            content: true,
            role: true,
            modelId: true,
            createdAt: true,
          }
        } 
      },
      orderBy: { updatedAt: "desc" }
    });

    console.log(`Found ${conversations.length} conversations`);
    
    // Generate titles for conversations without titles
    const conversationsWithTitles = await Promise.all(
      conversations.map(async (conv) => {
        if (!conv.title && conv.messages.length > 0) {
          try {
            console.log(`Generating title for conversation ${conv.id}`);
            const { TitleService } = await import("../../services/titleService");
            const title = await TitleService.generateTitle(conv.id);
            return { ...conv, title };
          } catch (error) {
            console.error(`Failed to generate title for conversation ${conv.id}:`, error);
            return { ...conv, title: "New Chat" };
          }
        }
        return conv;
      })
    );

    res.json(conversationsWithTitles);
  } catch (error: unknown) {
    console.error("Error getting conversations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET single conversation
router.get("/:conversationId", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const conversationId = req.params.conversationId;

    console.log(`Getting conversation ${conversationId} for user ${userId}`);

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { 
        id: conversationId,
        userId
      },
      include: { 
        messages: { 
          orderBy: { createdAt: "asc" }, // CRITICAL: Chronological order
          select: {
            id: true,
            content: true,
            role: true,
            modelId: true,
            createdAt: true,
          }
        }
      },
    });

    if (!conversation) {
      console.log(`Conversation ${conversationId} not found or unauthorized`);
      return res.status(404).json({ error: "Conversation not found" });
    }

    console.log(`Found conversation with ${conversation.messages.length} messages`);

    // Generate title if missing
    let title = conversation.title;
    if (!title) {
      try {
        console.log(`Generating title for conversation ${conversationId}`);
        const { TitleService } = await import("../../services/titleService");
        title = await TitleService.generateTitle(conversationId);
      } catch (error) {
        console.error(`Failed to generate title for conversation ${conversationId}:`, error);
        title = "New Chat";
      }
    }

    res.json({ 
      conversation: { 
        ...conversation, 
        title 
      } 
    });
  } catch (error: unknown) {
    console.error("Error getting conversation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE conversation
router.delete("/:conversationId", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const conversationId = req.params.conversationId;

    console.log(`Deleting conversation ${conversationId} for user ${userId}`);

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    // Verify ownership before deletion
    const conversation = await prisma.conversation.findUnique({
      where: { 
        id: conversationId,
        userId 
      },
      select: {
        id: true,
        _count: {
          select: { messages: true }
        }
      }
    });

    if (!conversation) {
      console.log(`Conversation ${conversationId} not found or unauthorized`);
      return res.status(404).json({ error: "Conversation not found" });
    }

    const messageCount = conversation._count.messages;
    console.log(`Deleting conversation with ${messageCount} messages`);

    // Delete conversation (cascade will handle messages)
    await prisma.conversation.delete({
      where: { id: conversationId }
    });

    console.log(`Successfully deleted conversation ${conversationId}`);

    res.json({ 
      success: true, 
      message: `Conversation and ${messageCount} messages deleted successfully`,
      deletedConversationId: conversationId,
      deletedMessagesCount: messageCount
    });

  } catch (error: unknown) {
    console.error("Error deleting conversation:", error);
    
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as { code: string };
      
      if (prismaError.code === 'P2025') {
        return res.status(404).json({ 
          error: "Conversation not found" 
        });
      }

      if (prismaError.code === 'P2003') {
        return res.status(400).json({ 
          error: "Cannot delete conversation due to foreign key constraint" 
        });
      }
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;