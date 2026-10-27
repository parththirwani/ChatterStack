import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { forkConversationAtMessage } from '@/src/lib/server/conversation-fork';
import { z } from 'zod';

const UUID = z.string().uuid();
const ForkSchema = z.object({ messageId: UUID }).strict();

/**
 * Forks a chat at one saved message: the new conversation holds everything from
 * the start through that message, and the source is left alone.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const parsed = ForkSchema.safeParse(await request.json().catch(() => null));
    // A malformed id in the URL is the same class of mistake as a malformed body.
    if (!UUID.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 });
    }
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid fork request', issues: parsed.error.issues }, { status: 400 });
    }

    const result = await forkConversationAtMessage(session.user.id, id, parsed.data.messageId);
    // One answer for a missing chat, someone else's chat, and a message that
    // isn't in that chat, so nothing here says whether the ids exist.
    if (!result.ok) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ conversation: result.conversation }, { status: 201 });
  } catch (error) {
    console.error('[API] Error forking conversation:', error);
    // Deliberately generic: the failure text can name tables or ids.
    return NextResponse.json({ error: 'Failed to fork conversation' }, { status: 500 });
  }
}
