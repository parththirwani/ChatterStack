import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const conversations = await prisma.conversation.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1, // Only get first message for preview
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    const total = await prisma.conversation.count({
      where: {
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        preview: c.messages[0]?.content.substring(0, 100) || '',
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch conversations',
      },
      { status: 500 }
    );
  }
}