import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { enforceUserScope } from '@/src/middleware/authMiddleware';
import { getUserProfile, saveUserProfile, EXPLANATION_STYLES, TECHNICAL_LEVELS } from '@/src/services/profile/storage';

const ProfileUpdateSchema = z.object({
  explanationStyle: z.enum(EXPLANATION_STYLES).optional(),
  technicalLevel: z.enum(TECHNICAL_LEVELS).optional(),
  preferences: z
    .object({
      likes: z.array(z.string().max(500)).max(100).optional(),
      dislikes: z.array(z.string().max(500)).max(100).optional(),
    })
    .optional(),
});


export async function GET(
  _request: NextRequest,
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

    const body = await request.json().catch(() => null);
    const parsed = ProfileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', errors: parsed.error.issues },
        { status: 400 }
      );
    }
    const { explanationStyle, technicalLevel, preferences } = parsed.data;

    const profile = await getUserProfile(targetUserId);
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (explanationStyle !== undefined) profile.explanationStyle = explanationStyle;
    if (technicalLevel !== undefined) profile.technicalLevel = technicalLevel;
    if (preferences) profile.preferences = { ...profile.preferences, ...preferences };

    profile.lastUpdated = new Date();

    await saveUserProfile(profile);

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}