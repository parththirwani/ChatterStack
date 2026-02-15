import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { getLLMTokenStatus } from '@/src/middleware/llmTokenRateLimit';

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const status = await getLLMTokenStatus(userId);

    return NextResponse.json({
      ...status,
      resetTime: new Date(status.resetAt).toISOString(),
    });
  } catch (error) {
    console.error('LLM token status error:', error);
    return NextResponse.json(
      { error: 'Failed to get token status' },
      { status: 500 }
    );
  }
}