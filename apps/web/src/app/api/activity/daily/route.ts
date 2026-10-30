import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';

const DEFAULT_DAYS = 91;
const MAX_DAYS = 370;

/**
 * Daily message counts for the signed-in user, oldest first, UTC calendar
 * days. Days with no chats are omitted; the client fills the gaps. Powers the
 * profile heatmap only for now, so it stays a small read-only endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requested = Number.parseInt(searchParams.get('days') || '', 10);
    const days = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 7), MAX_DAYS)
      : DEFAULT_DAYS;
    const since = new Date(Date.now() - (days - 1) * 86_400_000);

    const rows = await prisma.$queryRaw<{ date: string; count: number }[]>`
      SELECT to_char(m."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
             count(*)::int AS count
      FROM "messages" m
      JOIN "conversations" c ON c.id = m."conversationId"
      WHERE c."userId" = ${session.user.id} AND m."createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1`;

    return NextResponse.json({
      days: days,
      activity: rows.map((row) => ({ date: row.date, count: Number(row.count) })),
    });
  } catch (error) {
    console.error('Error fetching daily activity:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch activity',
      },
      { status: 500 }
    );
  }
}
