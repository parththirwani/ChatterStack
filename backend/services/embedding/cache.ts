import { RedisStore } from '../../store/RedisStore';
import crypto from 'crypto';

const EMBEDDING_MODEL = process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
const CACHE_TTL = parseInt(process.env.OPENROUTER_EMBEDDING_CACHE_TTL || '86400', 10);

/**
 * Generate cache key for embedding
 */
export function generateCacheKey(text: string, model: string = EMBEDDING_MODEL): string {
  const hash = crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
  return `embedding:${model}:${hash}`;
}

/**
 * Get cached embedding
 */
export async function getCachedEmbedding(text: string): Promise<number[] | null> {
  try {
    const redis = RedisStore.getInstance();
    const cacheKey = generateCacheKey(text);
    const cached = await redis.getKey(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to get cached embedding:', error);
    return null;
  }
}

/**
 * Cache embedding
 */
export async function cacheEmbedding(text: string, embedding: number[]): Promise<void> {
  try {
    const redis = RedisStore.getInstance();
    const cacheKey = generateCacheKey(text);
    await redis.setKey(cacheKey, JSON.stringify(embedding), CACHE_TTL);
  } catch (error) {
    console.warn('Failed to cache embedding:', error);
  }
}

/**
 * Get multiple cached embeddings
 */
export async function getCachedEmbeddings(
  texts: string[]
): Promise<{
  embeddings: (number[] | null)[];
  uncachedIndices: number[];
  uncachedTexts: string[];
}> {
  const embeddings: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;

    const cached = await getCachedEmbedding(text);
    if (cached) {
      embeddings[i] = cached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(text);
    }
  }

  return { embeddings, uncachedIndices, uncachedTexts };
}

/**
 * Cache multiple embeddings
 */
export async function cacheEmbeddings(
  texts: string[],
  embeddings: number[][]
): Promise<void> {
  const promises = texts.map((text, i) => cacheEmbedding(text, embeddings[i]));
  await Promise.allSettled(promises);
}

/**
 * Clear embedding cache for a specific text
 */
export async function clearEmbeddingCache(text: string): Promise<void> {
  try {
    const redis = RedisStore.getInstance();
    const cacheKey = generateCacheKey(text);
    await redis.deleteKey(cacheKey);
  } catch (error) {
    console.warn('Failed to clear embedding cache:', error);
  }
}

/**
 * Clear all embedding cache
 */
export async function clearAllEmbeddingCache(): Promise<void> {
  try {
    const redis = RedisStore.getInstance();
    const client = redis.getClient();
    const keys = await client.keys(`embedding:${EMBEDDING_MODEL}:*`);
    if (keys.length > 0) {
      await client.del(keys);
      console.log(`Cleared ${keys.length} embedding cache entries`);
    }
  } catch (error) {
    console.warn('Failed to clear all embedding cache:', error);
  }
}

/**
 * Get cache statistics
 */
export async function getEmbeddingCacheStats(): Promise<{
  totalKeys: number;
  estimatedSize: string;
}> {
  try {
    const redis = RedisStore.getInstance();
    const client = redis.getClient();
    const keys = await client.keys(`embedding:${EMBEDDING_MODEL}:*`);
    
    // Estimate size (rough calculation)
    // Each embedding is ~1536 floats * 8 bytes = ~12KB
    const estimatedSizeBytes = keys.length * 12000;
    const estimatedSizeMB = (estimatedSizeBytes / 1024 / 1024).toFixed(2);
    
    return {
      totalKeys: keys.length,
      estimatedSize: `${estimatedSizeMB} MB`,
    };
  } catch (error) {
    console.warn('Failed to get cache stats:', error);
    return {
      totalKeys: 0,
      estimatedSize: '0 MB',
    };
  }
}