import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { ingestMessage } from '@/src/app/services/rag/ingest';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { conversationId, messageId, content, role, modelUsed, timestamp } = body;

    // Validation
    if (!conversationId || !messageId || !content || !role) {
      return NextResponse.json(
        {
          error: 'Missing required fields: conversationId, messageId, content, role',
        },
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
      timestamp: timestamp ? new Date(timestamp) : undefined,
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