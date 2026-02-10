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

    // Retrieve context with fallback - pass timeWindowDays if provided
    const retrievalParams: {
      userId: string;
      query: string;
      currentConversationId?: string;
      shortTermMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
      timeWindowDays?: number;
    } = {
      userId,
      query,
      currentConversationId,
      shortTermMessages: shortTermMessages || [],
    };

    // Only add timeWindowDays if it's defined
    if (timeWindowDays !== undefined) {
      retrievalParams.timeWindowDays = timeWindowDays;
    }

    const context = await retrieveContextWithFallback(retrievalParams);

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