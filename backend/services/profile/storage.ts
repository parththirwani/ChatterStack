import { prisma } from '../../lib/prisma';
import type { UserProfile } from './types';

const DEFAULT_PROFILE: UserProfile = {
  userId: '',
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

    // Parse JSON profile
    const profile = user.profile as any;
    return {
      ...profile,
      userId,
      lastUpdated: user.profileUpdated || new Date(),
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
    await prisma.user.update({
      where: { id: profile.userId },
      data: {
        profile: profile as any,
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
  let profile = await getUserProfile(userId);
  
  if (!profile) {
    profile = await initializeProfile(userId);
  }
  
  return profile;
}