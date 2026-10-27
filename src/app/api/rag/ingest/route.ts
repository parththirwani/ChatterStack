import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { ingestMessage } from '@/src/services/rag/ingest';
import { RAG_INGEST_LIMITS, withUserRateLimits } from '@/src/middleware/requestRateLimit';

const IngestRequestSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  content: z.string().trim().min(1).max(200_000),
  role: z.enum(['user', 'assistant']),
  modelUsed: z.string().max(200).optional(),
  timestamp: z.coerce.date().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Each ingestion runs embeddings (billed per token): cap it per user.
    const limited = await withUserRateLimits(userId, RAG_INGEST_LIMITS);
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = IngestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', errors: parsed.error.issues },
        { status: 400 }
      );
    }
    const { conversationId, messageId, content, role, modelUsed, timestamp } = parsed.data;

    // The ids come from the caller: only ingest messages of the user's own
    // conversations, otherwise one account could poison another's memory.
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true },
    });
    if (!message) {
      return NextResponse.json(
        { error: 'messageId does not belong to this conversation' },
        { status: 400 }
      );
    }

    // Async ingestion (don't block response)
    ingestMessage({
      userId,
      conversationId,
      messageId,
      content,
      role,
      modelUsed,
      timestamp,
    }).catch((err) => {
      console.error('Async ingestion failed:', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Ingestion initiated',
    });
  } catch (error) {
    console.error('Ingest route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
