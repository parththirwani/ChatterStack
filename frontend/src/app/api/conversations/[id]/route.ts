import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // Changed: params is now a Promise
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
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: conversation.id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        modelId: m.modelId,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
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
  { params }: { params: Promise<{ id: string }> } // Changed: params is now a Promise
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete conversation',
      },
      { status: 500 }
    );
  }
}