import { prisma } from '@/src/lib/prisma';
import type { UserProfile } from './storage';
import { saveUserProfile, getOrCreateProfile } from './storage';

/**
 * Infer user profile from conversation history
 */
export async function inferUserProfile(userId: string): Promise<UserProfile> {
  // Get recent conversations
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 50, // Last 50 messages
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 5, // Last 5 conversations
  });

  if (conversations.length === 0) {
    return getOrCreateProfile(userId);
  }

  // Flatten messages
  const allMessages = conversations.flatMap((c: { messages: unknown[] }) => c.messages);

  // Get current profile
  const currentProfile = await getOrCreateProfile(userId);

  // Update message count
  const updatedProfile: UserProfile = {
    ...currentProfile,
    messageCount: allMessages.length,
    lastUpdated: new Date(),
    version: currentProfile.version + 1,
  };

  await saveUserProfile(updatedProfile);
  console.log(`✓ Updated profile for user ${userId}`);

  return updatedProfile;
}

/**
 * Incremental profile update (lightweight)
 */
export async function incrementalProfileUpdate(
  userId: string,
  newMessage: { role: 'user' | 'assistant'; content: string }
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { profile: true, profileUpdated: true },
    });

    if (!user) return;

    // Initialize profile with default structure
    const storedProfile = user.profile as Record<string, unknown> | null;
    
    let profile: UserProfile;
    if (storedProfile && typeof storedProfile === 'object') {
      profile = {
        userId,
        technicalLevel: (storedProfile.technicalLevel as UserProfile['technicalLevel']) || 'intermediate',
        explanationStyle: (storedProfile.explanationStyle as UserProfile['explanationStyle']) || 'detailed',
        preferences: (storedProfile.preferences as UserProfile['preferences']) || {},
        topicFrequency: (storedProfile.topicFrequency as Record<string, number>) || {},
        messageCount: (storedProfile.messageCount as number) || 0,
        lastUpdated: storedProfile.lastUpdated 
          ? new Date(storedProfile.lastUpdated as string) 
          : new Date(),
        version: (storedProfile.version as number) || 1,
      };
    } else {
      profile = {
        userId,
        technicalLevel: 'intermediate',
        explanationStyle: 'detailed',
        preferences: {},
        topicFrequency: {},
        messageCount: 0,
        lastUpdated: new Date(),
        version: 1,
      };
    }

    // Ensure topicFrequency exists
    if (!profile.topicFrequency) {
      profile.topicFrequency = {};
    }

    // Extract topics from user messages
    if (newMessage.role === 'user') {
      const topics = extractTopics(newMessage.content);
      for (const topic of topics) {
        profile.topicFrequency[topic] = (profile.topicFrequency[topic] || 0) + 1;
      }
    }

    profile.messageCount = (profile.messageCount || 0) + 1;
    profile.lastUpdated = new Date();

    await saveUserProfile(profile);
  } catch (error) {
    console.error('Profile update failed:', error);
  }
}

/**
 * Extract topics from message content (simple keyword extraction)
 */
function extractTopics(content: string): string[] {
  const topicKeywords = {
    frontend: ['react', 'vue', 'angular', 'css', 'html', 'typescript', 'ui', 'frontend'],
    backend: ['node', 'express', 'api', 'database', 'sql', 'backend', 'server'],
    infrastructure: ['docker', 'kubernetes', 'aws', 'cloud', 'deployment', 'infra'],
    ai: ['ai', 'ml', 'machine learning', 'neural', 'gpt', 'llm', 'embedding'],
    security: ['security', 'auth', 'encryption', 'jwt', 'oauth'],
    performance: ['performance', 'optimization', 'cache', 'speed', 'latency'],
  };

  const detected: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => lowerContent.includes(kw))) {
      detected.push(topic);
    }
  }

  return detected;
}

/**
 * Get profile summary for query enhancement
 */
export function getProfileSummary(profile: UserProfile): string {
  const topTopics = Object.entries(profile.topicFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic]) => topic);

  return `
User Profile:
- Technical Level: ${profile.technicalLevel}
- Preferred Style: ${profile.explanationStyle}
- Main Interests: ${topTopics.join(', ') || 'general'}
${profile.preferences.dislikes?.length ? `- Dislikes: ${profile.preferences.dislikes.join(', ')}` : ''}
`.trim();
}