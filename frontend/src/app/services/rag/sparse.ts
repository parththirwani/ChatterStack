/**
 * Simple BM25-style sparse vector generation
 * For production, consider using Qdrant's built-in sparse model
 */

interface SparseVector {
  indices: number[];
  values: number[];
}

// Simple tokenizer
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

// Build vocabulary (in production, use a pre-built vocab)
const VOCAB_CACHE = new Map<string, number>();
let nextVocabId = 0;

function getTokenId(token: string): number {
  if (!VOCAB_CACHE.has(token)) {
    VOCAB_CACHE.set(token, nextVocabId++);
  }
  return VOCAB_CACHE.get(token)!;
}

/**
 * Generate sparse vector using simple TF weighting
 */
export function generateSparseVector(text: string): SparseVector {
  const tokens = tokenize(text);
  const termFreq = new Map<number, number>();
  
  // Count term frequencies
  for (const token of tokens) {
    const id = getTokenId(token);
    termFreq.set(id, (termFreq.get(id) || 0) + 1);
  }
  
  // Normalize
  const totalTerms = tokens.length;
  const indices: number[] = [];
  const values: number[] = [];
  
  for (const [id, freq] of termFreq.entries()) {
    indices.push(id);
    values.push(freq / totalTerms); // Simple TF normalization
  }
  
  return { indices, values };
}

/**
 * For production: use Qdrant's sparse model or fast-bm25
 * This is a simplified version for demonstration
 */