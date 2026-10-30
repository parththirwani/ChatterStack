import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { getConversation } from '@/src/lib/server/conversations';
import { AnalyticsEvents } from '@/src/lib/analytics/events';
import { captureServerEvent } from '@/src/lib/analytics/posthog-server';
import { z } from 'zod';

const UpdateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((body) => body.title !== undefined || body.pinned !== undefined, 'Nothing to update');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await getConversation(session.user.id, id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json({ conversation });
  } catch (error) {
    console.error('[API] Error fetching conversation:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch conversation',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: {
        id: id,
        userId: session.user.id,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    await prisma.conversation.delete({
      where: {
        id: id,
      },
    });

    // Also clear from Redis cache
    const { redisStore } = await import('@/src/lib/redis');
    await redisStore.delete(id);

    captureServerEvent(session.user.id, AnalyticsEvents.ConversationDeleted, {});
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting conversation:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete conversation',
      },
      { status: 500 }
    );
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const parsed = UpdateConversationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid update', issues: parsed.error.issues }, { status: 400 });
    }

    const { title, pinned } = parsed.data;
    const existing = await prisma.conversation.findFirst({
      where: { id, userId: session.user.id },
      select: { updatedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Renaming or pinning isn't activity: keep updatedAt (which Prisma would
    // otherwise bump) so the chat doesn't jump to the top of the list.
    const conversation = await prisma.conversation.update({
      where: { id, userId: session.user.id },
      data: {
        ...(title !== undefined && { title }),
        ...(pinned !== undefined && { pinnedAt: pinned ? new Date() : null }),
        updatedAt: existing.updatedAt,
      },
      select: { id: true, title: true, pinnedAt: true, updatedAt: true },
    });

    if (pinned !== undefined) {
      captureServerEvent(session.user.id, AnalyticsEvents.ConversationPinned, { pinned });
    }

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        pinnedAt: conversation.pinnedAt?.toISOString() ?? null,
        updatedAt: conversation.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[API] Error updating conversation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update conversation' },
      { status: 500 }
    );
  }
}
