import { ingestMessage } from '@/src/app/services/rag/ingest';
import { NextRequest, NextResponse } from 'next/server';
/**
 * POST /api/rag/ingest
 * Ingest a message into the RAG system
 */
async function handler(request: NextRequest, userId: string) {
  try {
    const body = await request.json();
    const {
      conversationId,
      messageId,
      content,
      role,
      modelUsed,
      timestamp,
    } = body;

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
    }).catch(err => {
      console.error('Async ingestion failed:', err);
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Ingestion initiated' 
    });
  } catch (error) {
    console.error('Ingest route error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler);