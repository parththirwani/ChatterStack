import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { enforceUserScope } from '@/src/middleware/authMiddleware';
import { getUserProfile, saveUserProfile } from '@/src/services/profile/storage';


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> } 
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authenticatedUserId = session.user.id;
    const { userId: targetUserId } = await params; // Await params

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> } // Changed
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authenticatedUserId = session.user.id;
    const { userId: targetUserId } = await params; // Await params

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const scopeCheck = enforceUserScope(authenticatedUserId, targetUserId);
    if (!scopeCheck.allowed) {
      return scopeCheck.error!;
    }

    const body = await request.json();
    const { explanationStyle, technicalLevel, preferences } = body;

    const profile = await getUserProfile(targetUserId);
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

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