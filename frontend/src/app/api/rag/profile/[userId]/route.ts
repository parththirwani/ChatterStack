import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { enforceUserScope } from '@/src/middleware/authMiddleware';
import { getUserProfile, saveUserProfile } from '@/src/services/profile/storage';


/**
 * GET /api/rag/profile/[userId]
 * Get user profile
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authenticatedUserId = session.user.id;
    const targetUserId = params.userId;

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Users can only access their own profile
    const scopeCheck = enforceUserScope(authenticatedUserId, targetUserId);
    if (!scopeCheck.allowed) {
      return scopeCheck.error!;
    }

    const profile = await getUserProfile(targetUserId);

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/rag/profile/[userId]
 * Manually update profile preferences
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authenticatedUserId = session.user.id;
    const targetUserId = params.userId;

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Users can only update their own profile
    const scopeCheck = enforceUserScope(authenticatedUserId, targetUserId);
    if (!scopeCheck.allowed) {
      return scopeCheck.error!;
    }

    const body = await request.json();
    const { explanationStyle, technicalLevel, preferences } = body;

    let profile = await getUserProfile(targetUserId);
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Update allowed fields
    if (explanationStyle) profile.explanationStyle = explanationStyle;
    if (technicalLevel) profile.technicalLevel = technicalLevel;
    if (preferences)
      profile.preferences = { ...profile.preferences, ...preferences };

    profile.lastUpdated = new Date();

    await saveUserProfile(profile);

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}