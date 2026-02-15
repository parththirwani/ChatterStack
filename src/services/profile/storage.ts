import { prisma } from '@/src/lib/prisma';
import { Prisma } from '@prisma/client';

export type TechnicalLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export type ExplanationStyle =
  | 'concise'
  | 'detailed'
  | 'example-heavy'
  | 'analogy-heavy'
  | 'code-first'
  | 'bullet-points';

export interface UserProfile {
  userId: string;
  technicalLevel: TechnicalLevel;
  explanationStyle: ExplanationStyle;
  topicFrequency: Record<string, number>;
  preferences: {
    likes?: string[];
    dislikes?: string[];
  };
  messageCount: number;
  lastUpdated: Date;
  version: number;
}

const DEFAULT_PROFILE: Omit<UserProfile, 'userId'> = {
  technicalLevel: 'intermediate',
  explanationStyle: 'detailed',
  topicFrequency: {},
  preferences: {
    dislikes: [],
    likes: [],
  },
  messageCount: 0,
  lastUpdated: new Date(),
  version: 1,
};

/**
 * Get user profile from database
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { profile: true, profileUpdated: true },
    });

    if (!user || !user.profile) {
      return null;
    }

    // Parse JSON profile - Prisma returns JsonValue
    const profileData = user.profile as Prisma.JsonObject;
    
    return {
      userId,
      technicalLevel: (profileData.technicalLevel as TechnicalLevel) || 'intermediate',
      explanationStyle: (profileData.explanationStyle as ExplanationStyle) || 'detailed',
      topicFrequency: (profileData.topicFrequency as Record<string, number>) || {},
      preferences: (profileData.preferences as { likes?: string[]; dislikes?: string[] }) || { likes: [], dislikes: [] },
      messageCount: (profileData.messageCount as number) || 0,
      lastUpdated: user.profileUpdated ? new Date(user.profileUpdated) : new Date(),
      version: (profileData.version as number) || 1,
    };
  } catch (error) {
    console.error('Failed to get user profile:', error);
    return null;
  }
}

/**
 * Save/update user profile
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    // Convert to plain object for JSON storage
    const profileData = {
      userId: profile.userId,
      technicalLevel: profile.technicalLevel,
      explanationStyle: profile.explanationStyle,
      topicFrequency: profile.topicFrequency,
      preferences: profile.preferences,
      messageCount: profile.messageCount,
      lastUpdated: profile.lastUpdated.toISOString(),
      version: profile.version,
    };

    await prisma.user.update({
      where: { id: profile.userId },
      data: {
        profile: profileData,
        profileUpdated: new Date(),
      },
    });

    console.log(`✓ Updated profile for user ${profile.userId}`);
  } catch (error) {
    console.error('Failed to save user profile:', error);
    throw error;
  }
}

/**
 * Initialize profile for new user
 */
export async function initializeProfile(userId: string): Promise<UserProfile> {
  const profile: UserProfile = {
    ...DEFAULT_PROFILE,
    userId,
  };

  await saveUserProfile(profile);
  return profile;
}

/**
 * Get or create profile
 */
export async function getOrCreateProfile(userId: string): Promise<UserProfile> {
  const existingProfile = await getUserProfile(userId);

  if (!existingProfile) {
    return await initializeProfile(userId);
  }

  return existingProfile;
}