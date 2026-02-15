import { redisStore } from '@/src/lib/redis';
import crypto from 'crypto';

const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
const CACHE_TTL = parseInt(
  process.env.OPENROUTER_EMBEDDING_CACHE_TTL || '86400',
  10
);

/**
 * Generate cache key for embedding
 */
function generateCacheKey(text: string, model: string = EMBEDDING_MODEL): string {
  const hash = crypto
    .createHash('sha256')
    .update(text)
    .digest('hex')
    .substring(0, 16);
  return `embedding:${model}:${hash}`;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  // Check cache first
  const cacheKey = generateCacheKey(text);

  try {
    const cached = await redisStore.getKey(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn('Embedding cache read failed:', err);
  }

  // Generate embedding
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  const embedding = data.data[0].embedding;

  // Cache the result
  try {
    await redisStore.setKey(cacheKey, JSON.stringify(embedding), CACHE_TTL);
  } catch (err) {
    console.warn('Embedding cache write failed:', err);
  }

  return embedding;
}

/**
 * Batch generate embeddings for multiple texts
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const embeddings: (number[] | undefined)[] = new Array(texts.length);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;

    const cacheKey = generateCacheKey(text);
    try {
      const cached = await redisStore.getKey(cacheKey);
      if (cached) {
        embeddings[i] = JSON.parse(cached);
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(text);
      }
    } catch (err) {
      uncachedIndices.push(i);
      uncachedTexts.push(text);
      console.error('OpenRouter error:', err);
      throw new Error('Failed to generate embedding');
    }
  }

  // Generate embeddings for uncached texts (batch)
  if (uncachedTexts.length > 0) {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: uncachedTexts,
      }),
    });

    if (!response.ok) {
      throw new Error(`Batch embedding API error: ${response.status}`);
    }

    const data = await response.json();

    // Fill in embeddings and cache
    for (let i = 0; i < uncachedTexts.length; i++) {
      const embedding = data.data[i].embedding;
      const originalIndex = uncachedIndices[i];
      const originalText = uncachedTexts[i];

      if (originalIndex !== undefined && originalText !== undefined) {
        embeddings[originalIndex] = embedding;

        // Cache
        const cacheKey = generateCacheKey(originalText);
        try {
          await redisStore.setKey(cacheKey, JSON.stringify(embedding), CACHE_TTL);
        } catch (err) {
          console.warn('Batch embedding cache write failed:', err);
        }
      }
    }
  }

  // Filter out undefined values and return properly typed array
  return embeddings.filter((e): e is number[] => e !== undefined);
}

/**
 * Clear embedding cache for a specific text
 */
export async function clearEmbeddingCache(text: string): Promise<void> {
  try {
    const cacheKey = generateCacheKey(text);
    await redisStore.deleteKey(cacheKey);
  } catch (error) {
    console.warn('Failed to clear embedding cache:', error);
  }
}