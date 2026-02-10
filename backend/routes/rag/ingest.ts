import { Router } from 'express';
import { authenticate } from '../../middleware/authentication';
import { ingestMessage } from '../../services/rag/ingest';

const router = Router();

/**
 * POST /api/rag/ingest
 * Ingest a message into the RAG system
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const {
      conversationId,
      messageId,
      content,
      role,
      modelUsed,
      timestamp,
    } = req.body;

    // Validation
    if (!conversationId || !messageId || !content || !role) {
      return res.status(400).json({
        error: 'Missing required fields: conversationId, messageId, content, role',
      });
    }

    // Async ingestion (don't block response)
    ingestMessage({
      userId,
      conversationId,
      messageId,
      content,
      role,
      modelUsed,
      timestamp: timestamp ? new Date(timestamp) : undefined,
    }).catch(err => {
      console.error('Async ingestion failed:', err);
    });

    res.json({ success: true, message: 'Ingestion initiated' });
  } catch (error) {
    console.error('Ingest route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;