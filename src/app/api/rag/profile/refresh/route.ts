import { NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { inferUserProfile } from '@/src/services/profile/profiler';
import { PROFILE_REFRESH_LIMITS, withUserRateLimits } from '@/src/middleware/requestRateLimit';

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Profile inference runs LLM calls over the user's history: cap it.
    const limited = await withUserRateLimits(userId, PROFILE_REFRESH_LIMITS);
    if (limited) return limited;

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
