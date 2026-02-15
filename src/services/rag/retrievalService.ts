import { getQdrantClient } from '@/src/lib/qdrant';
import { HybridSearchResult, RetrievalContext } from './types';
import { generateEmbedding } from './openrouter';
import { generateSparseVector } from './sparse';


const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'chatterstack_memory';
const TOP_K_DENSE = parseInt(process.env.RAG_TOP_K_DENSE || '10', 10);
const TOP_K_SPARSE = parseInt(process.env.RAG_TOP_K_SPARSE || '10', 10);
const TOP_K_FINAL = parseInt(process.env.RAG_TOP_K_FINAL || '5', 10);
const TIME_WINDOW_DAYS = parseInt(process.env.RAG_TIME_WINDOW_DAYS || '90', 10);

// Qdrant filter types
interface QdrantMatchFilter {
  key: string;
  match: { value: string };
}

interface QdrantRangeFilter {
  key: string;
  range: { gte?: string; lt?: string };
}

type QdrantFilterCondition = QdrantMatchFilter | QdrantRangeFilter;

interface QdrantFilter {
  must: QdrantFilterCondition[];
  must_not?: QdrantMatchFilter[];
}

interface RankResult {
  id: string;
  rank: number;
  payload: Record<string, unknown>;
}

/**
 * Retrieve relevant context for a user query
 */
export async function retrieveContext(params: {
  userId: string;
  query: string;
  currentConversationId?: string;
  shortTermMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  timeWindowDays?: number;
}): Promise<RetrievalContext> {
  const {
    userId,
    query,
    currentConversationId,
    shortTermMessages = [],
    timeWindowDays = TIME_WINDOW_DAYS,
  } = params;

  try {
    // Perform hybrid search
    const results = await hybridSearch({
      userId,
      query,
      currentConversationId,
      timeWindowDays,
    });

    // Format context
    const chunks = results.slice(0, TOP_K_FINAL).map(r => ({
      content: r.payload.content as string,
      score: r.score,
      conversationId: r.payload.conversationId as string,
      timestamp: r.payload.timestamp as string,
      isCode: r.payload.isCode as boolean,
    }));

    return {
      chunks,
      shortTermContext: shortTermMessages.slice(-8), // Last 4-8 turns
    };
  } catch (error) {
    console.error('Retrieval error:', error);
    // Fallback: return only short-term context
    return {
      chunks: [],
      shortTermContext: shortTermMessages.slice(-8),
    };
  }
}

/**
 * Hybrid search: Dense + Sparse with RRF fusion
 */
async function hybridSearch(params: {
  userId: string;
  query: string;
  currentConversationId?: string;
  timeWindowDays: number;
}): Promise<HybridSearchResult[]> {
  const { userId, query, currentConversationId, timeWindowDays } = params;
  
  const client = getQdrantClient();
  
  // Time filter
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - timeWindowDays);
  
  // Base filter
  const baseFilter: QdrantFilter = {
    must: [
      { key: 'userId', match: { value: userId } },
      { key: 'timestamp', range: { gte: cutoffDate.toISOString() } },
    ],
  };
  
  // Exclude current conversation (optional)
  if (currentConversationId) {
    baseFilter.must_not = [
      { key: 'conversationId', match: { value: currentConversationId } },
    ];
  }

  // 1. Dense (semantic) search
  const queryVector = await generateEmbedding(query);
  const denseResults = await client.search(COLLECTION_NAME, {
    vector: queryVector,
    filter: baseFilter,
    limit: TOP_K_DENSE,
    with_payload: true,
  });

  // 2. Sparse (BM25) search
  const sparseVector = generateSparseVector(query);
  const sparseResults = await client.search(COLLECTION_NAME, {
    vector: {
      name: 'text',
      vector: sparseVector,
    },
    filter: baseFilter,
    limit: TOP_K_SPARSE,
    with_payload: true,
  });

  // 3. Reciprocal Rank Fusion (RRF)
  const fused = reciprocalRankFusion(
    denseResults.map((r, idx) => ({ id: r.id as string, rank: idx + 1, payload: r.payload as Record<string, unknown> })),
    sparseResults.map((r, idx) => ({ id: r.id as string, rank: idx + 1, payload: r.payload as Record<string, unknown> }))
  );

  return fused;
}

/**
 * Reciprocal Rank Fusion
 */
function reciprocalRankFusion(
  denseResults: RankResult[],
  sparseResults: RankResult[],
  k: number = 60
): HybridSearchResult[] {
  const scores = new Map<string, number>();
  const payloads = new Map<string, Record<string, unknown>>();

  // Dense scores
  for (const result of denseResults) {
    scores.set(result.id, (scores.get(result.id) || 0) + 1 / (k + result.rank));
    payloads.set(result.id, result.payload);
  }

  // Sparse scores
  for (const result of sparseResults) {
    scores.set(result.id, (scores.get(result.id) || 0) + 1 / (k + result.rank));
    if (!payloads.has(result.id)) {
      payloads.set(result.id, result.payload);
    }
  }

  // Sort by fused score
  const fused = Array.from(scores.entries())
    .map(([id, score]) => ({
      id,
      score,
      payload: payloads.get(id)!,
    }))
    .sort((a, b) => b.score - a.score);

  return fused as HybridSearchResult[];
}

/**
 * Format context for LLM injection
 */
export function formatContextForLLM(context: RetrievalContext): string {
  let formatted = '';

  // Short-term context (recent conversation)
  if (context.shortTermContext.length > 0) {
    formatted += '## Recent Conversation\n\n';
    for (const msg of context.shortTermContext) {
      formatted += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n\n`;
    }
  }

  // Long-term context (retrieved from RAG)
  if (context.chunks.length > 0) {
    formatted += '## Relevant Context from Past Conversations\n\n';
    for (const chunk of context.chunks) {
      const date = new Date(chunk.timestamp).toLocaleDateString();
      formatted += `[${date}] ${chunk.content}\n\n`;
    }
  }

  return formatted;
}

/**
 * Graceful degradation when Qdrant is unavailable
 */
export async function retrieveContextWithFallback(params: {
  userId: string;
  query: string;
  currentConversationId?: string;
  shortTermMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  timeWindowDays?: number;
}): Promise<RetrievalContext> {
  try {
    // Try full RAG retrieval
    return await retrieveContext(params);
  } catch (error) {
    console.error('RAG retrieval failed, using short-term memory only:', error);
    
    // Fallback: return only short-term context
    return {
      chunks: [],
      shortTermContext: params.shortTermMessages || [],
    };
  }
}