import { RedisStore } from '../../store/RedisStore';

const EMBEDDING_MODEL = process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
const CACHE_TTL = parseInt(process.env.OPENROUTER_EMBEDDING_CACHE_TTL || '86400', 10);

interface EmbeddingResponse {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Check cache first
  const cacheKey = `embedding:${EMBEDDING_MODEL}:${hashText(text)}`;
  const redis = RedisStore.getInstance();
  
  try {
    const cached = await redis.client.get(cacheKey);
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
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
    await redis.client.setex(cacheKey, CACHE_TTL, JSON.stringify(embedding));
  } catch (err) {
    console.warn('Embedding cache write failed:', err);
  }

  return embedding;
}

/**
 * Batch generate embeddings for multiple texts
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const cacheKey = `embedding:${EMBEDDING_MODEL}:${hashText(texts[i])}`;
    try {
      const cached = await RedisStore.getInstance().client.get(cacheKey);
      if (cached) {
        embeddings[i] = JSON.parse(cached);
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    } catch (err) {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  // Generate embeddings for uncached texts (batch)
  if (uncachedTexts.length > 0) {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
      embeddings[originalIndex] = embedding;

      // Cache
      const cacheKey = `embedding:${EMBEDDING_MODEL}:${hashText(uncachedTexts[i])}`;
      try {
        await RedisStore.getInstance().client.setex(
          cacheKey,
          CACHE_TTL,
          JSON.stringify(embedding)
        );
      } catch (err) {
        console.warn('Batch embedding cache write failed:', err);
      }
    }
  }

  return embeddings;
}

/**
 * Simple hash function for cache keys
 */
function hashText(text: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}