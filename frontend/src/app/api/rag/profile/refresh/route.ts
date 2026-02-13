import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { inferUserProfile } from '@/src/services/profile/profiler';

export async function POST(_request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Trigger async profile inference
    inferUserProfile(userId).catch((err) =>
      console.error('Background profile inference failed:', err)
    );

    return NextResponse.json({
      success: true,
      message: 'Profile refresh initiated',
    });
  } catch (error) {
    console.error('Profile refresh error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}