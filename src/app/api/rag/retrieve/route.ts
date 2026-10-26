import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { retrieveContextWithFallback, formatContextForLLM } from '@/src/services/rag/retrievalService';
import { RAG_RETRIEVE_LIMITS, withUserRateLimits } from '@/src/middleware/requestRateLimit';

const RetrieveRequestSchema = z.object({
  query: z.string().trim().min(1).max(8000),
  currentConversationId: z.string().uuid().optional(),
  shortTermMessages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(20_000),
      })
    )
    .max(50)
    .optional(),
  timeWindowDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Retrieval embeds the query on every call: cap it per user.
    const limited = await withUserRateLimits(userId, RAG_RETRIEVE_LIMITS);
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = RetrieveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', errors: parsed.error.issues },
        { status: 400 }
      );
    }
    const { query, currentConversationId, shortTermMessages, timeWindowDays } = parsed.data;

    // Retrieve context with fallback
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
      shortTermMessages: shortTermMessages ?? [],
    };

    if (timeWindowDays !== undefined) {
      retrievalParams.timeWindowDays = timeWindowDays;
    }

    const context = await retrieveContextWithFallback(retrievalParams);

    // Format for LLM
    const formattedContext = formatContextForLLM(context);

    return NextResponse.json({
      success: true,
      context,
      formatted: formattedContext,
    });
  } catch (error) {
    console.error('Retrieve route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
