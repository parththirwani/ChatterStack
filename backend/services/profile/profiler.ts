import { prisma } from '../../lib/prisma';
import { createCompletion } from '../../openrouter';
import { Role } from '../../types';
import { getUserProfile, saveUserProfile, getOrCreateProfile } from './storage';
import type { UserProfile } from './types';

const PROFILE_UPDATE_THRESHOLD = parseInt(
  process.env.PROFILE_UPDATE_THRESHOLD || '5',
  10
);

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
  const allMessages = conversations.flatMap(c => c.messages);
  
  // Build conversation sample
  const sample = allMessages
    .slice(0, 30)
    .map(m => `${m.role}: ${m.content.substring(0, 300)}`)
    .join('\n\n');

  // Inference prompt
  const prompt = `Analyze the following conversation history and infer the user's profile:

${sample}

Based on this, determine:

1. Technical Level (beginner/intermediate/advanced/expert)
2. Preferred Explanation Style (concise/detailed/example-heavy/analogy-heavy/code-first/bullet-points)
3. Main Topics of Interest (list up to 5)
4. Communication Preferences (what they like/dislike)

Respond in JSON format:
{
  "technicalLevel": "...",
  "explanationStyle": "...",
  "topics": ["topic1", "topic2", ...],
  "likes": ["preference1", ...],
  "dislikes": ["annoyance1", ...]
}`;

  try {
    let response = '';
    await createCompletion(
      [{ role: Role.User, content: prompt }],
      'gpt-4o', // Use more capable model for profiling
      (chunk) => { response += chunk; }
    );

    // Parse inference
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse profile inference');
    }

    const inference = JSON.parse(jsonMatch[0]);
    
    // Build profile
    const currentProfile = await getOrCreateProfile(userId);
    
    const topicFrequency: Record<string, number> = { ...currentProfile.topicFrequency };
    for (const topic of inference.topics || []) {
      topicFrequency[topic] = (topicFrequency[topic] || 0) + 1;
    }

    const updatedProfile: UserProfile = {
      ...currentProfile,
      technicalLevel: inference.technicalLevel || currentProfile.technicalLevel,
      explanationStyle: inference.explanationStyle || currentProfile.explanationStyle,
      topicFrequency,
      preferences: {
        likes: [...new Set([...(currentProfile.preferences.likes || []), ...(inference.likes || [])])],
        dislikes: [...new Set([...(currentProfile.preferences.dislikes || []), ...(inference.dislikes || [])])],
      },
      messageCount: allMessages.length,
      lastUpdated: new Date(),
      version: currentProfile.version + 1,
    };

    await saveUserProfile(updatedProfile);
    console.log(`✓ Updated profile for user ${userId}`);
    
    return updatedProfile;
  } catch (error) {
    console.error('Profile inference failed:', error);
    return getOrCreateProfile(userId);
  }
}

/**
 * Incremental profile update (lightweight)
 */
export async function incrementalProfileUpdate(
  userId: string,
  newMessage: { role: 'user' | 'assistant'; content: string }
): Promise<void> {
  const profile = await getOrCreateProfile(userId);
  
  // Update message count
  profile.messageCount += 1;

  // Extract topics from user messages
  if (newMessage.role === 'user') {
    const topics = extractTopics(newMessage.content);
    for (const topic of topics) {
      profile.topicFrequency[topic] = (profile.topicFrequency[topic] || 0) + 1;
    }
  }

  // Trigger full inference every N messages
  if (profile.messageCount % PROFILE_UPDATE_THRESHOLD === 0) {
    console.log(`Triggering full profile inference for user ${userId}`);
    await inferUserProfile(userId);
  } else {
    await saveUserProfile(profile);
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
    if (keywords.some(kw => lowerContent.includes(kw))) {
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