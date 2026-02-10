import { createCompletion } from '../../openrouter';
import { Role } from '../../types';
import type { UserProfile } from '../profile/types';

/**
 * Rewrite query based on conversation context and user profile
 */
export async function rewriteQuery(
  originalQuery: string,
  shortTermMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  profile?: UserProfile | null
): Promise<string> {
  // If no context, return original
  if (shortTermMessages.length === 0 && !profile) {
    return originalQuery;
  }

  // Build context
  const conversationContext = shortTermMessages
    .slice(-4) // Last 2 turns
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const profileContext = profile
    ? `User preferences: ${profile.explanationStyle} explanations, ${profile.technicalLevel} level`
    : '';

  // Rewrite prompt
  const prompt = `Given the following conversation context and user preferences, rewrite the user's query to be more specific and searchable.

Conversation:
${conversationContext}

${profileContext}

Original Query: ${originalQuery}

Rewritten Query (be concise, focus on key concepts and entities):`;

  try {
    let rewritten = '';
    await createCompletion(
      [{ role: Role.User, content: prompt }],
      'gpt-3.5-turbo',
      (chunk) => { rewritten += chunk; }
    );

    return rewritten.trim() || originalQuery;
  } catch (error) {
    console.error('Query rewriting failed:', error);
    return originalQuery;
  }
}

/**
 * HyDE: Hypothetical Document Embeddings
 * Generate a hypothetical answer and use it for retrieval
 */
export async function generateHyDE(query: string): Promise<string> {
  const prompt = `Generate a concise, factual answer to the following question. This will be used for semantic search.

Question: ${query}

Answer (2-3 sentences):`;

  try {
    let hypothetical = '';
    await createCompletion(
      [{ role: Role.User, content: prompt }],
      'gpt-3.5-turbo',
      (chunk) => { hypothetical += chunk; }
    );

    return hypothetical.trim();
  } catch (error) {
    console.error('HyDE generation failed:', error);
    return query;
  }
}

/**
 * Multi-query generation for better recall
 */
export async function generateMultiQuery(originalQuery: string): Promise<string[]> {
  const prompt = `Generate 3 alternative phrasings of the following query for better semantic search coverage.

Original: ${originalQuery}

Alternatives (one per line):`;

  try {
    let alternatives = '';
    await createCompletion(
      [{ role: Role.User, content: prompt }],
      'gpt-3.5-turbo',
      (chunk) => { alternatives += chunk; }
    );

    return [originalQuery, ...alternatives.trim().split('\n').filter(Boolean)];
  } catch (error) {
    console.error('Multi-query generation failed:', error);
    return [originalQuery];
  }
}