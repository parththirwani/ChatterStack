import { Router } from 'express';
import { authenticate } from '../../middleware/authentication';
import { retrieveContextWithFallback, formatContextForLLM } from '../../services/rag/retrieval';

const router = Router();

/**
 * POST /api/rag/retrieve
 * Retrieve relevant context for a query
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const {
      query,
      currentConversationId,
      shortTermMessages,
      timeWindowDays,
    } = req.body;

    // Validation
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Retrieve context with fallback
    const context = await retrieveContextWithFallback({
      userId,
      query,
      currentConversationId,
      shortTermMessages: shortTermMessages || [],
      timeWindowDays,
    });

    // Format for LLM
    const formattedContext = formatContextForLLM(context);

    res.json({
      success: true,
      context,
      formatted: formattedContext,
    });
  } catch (error) {
    console.error('Retrieve route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;