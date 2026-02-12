import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import {
  retrieveContextWithFallback,
  formatContextForLLM,
} from '@/src/services/retrievalService';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { query, currentConversationId, shortTermMessages, timeWindowDays } = body;

    // Validation
    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

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
      shortTermMessages: shortTermMessages || [],
    };

    // Only add timeWindowDays if it's defined
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