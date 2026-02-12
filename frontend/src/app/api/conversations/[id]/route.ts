// frontend/src/app/api/conversations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { generateTitle } from '@/src/services/titleService';

// GET /api/conversations - Get all conversations for authenticated user
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            content: true,
            role: true,
            modelId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Generate titles for conversations without titles
    const conversationsWithTitles = await Promise.all(
      conversations.map(async (conv) => {
        if (!conv.title && conv.messages.length > 0) {
          try {
            const title = await generateTitle(conv.id);
            return { ...conv, title };
          } catch (error) {
            console.error(`Failed to generate title for conversation ${conv.id}:`, error);
            return { ...conv, title: 'New Chat' };
          }
        }
        return conv;
      })
    );

    return NextResponse.json(conversationsWithTitles);
  } catch (error) {
    console.error('Error getting conversations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}