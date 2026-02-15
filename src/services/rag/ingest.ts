import { getQdrantClient } from '@/src/lib/qdrant';
import { chunkMessage } from './chunker';
import { generateSparseVector } from './sparse';
import type { RagPoint } from './types';
import { v4 as uuidv4 } from 'uuid';
import { generateEmbeddings } from './openrouter';

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'chatterstack_memory';

/**
 * Ingest a message into the RAG system
 * Now with better error handling for embedding failures
 */
export async function ingestMessage(params: {
  userId: string;
  conversationId: string;
  messageId: string;
  content: string;
  role: 'user' | 'assistant';
  modelUsed?: string;
  timestamp?: Date;
  profileTags?: string[];
}): Promise<void> {
  const {
    userId,
    conversationId,
    messageId,
    content,
    role,
    modelUsed,
    timestamp = new Date(),
    profileTags = [],
  } = params;

  try {
    // 1. Chunk the message
    const chunks = chunkMessage(content, messageId);
    console.log(`Chunking message ${messageId}: ${chunks.length} chunks`);

    // 2. Generate dense embeddings (batch)
    const chunkTexts = chunks.map((c) => c.content);
    
    let denseVectors: number[][] = [];
    try {
      denseVectors = await generateEmbeddings(chunkTexts);
    } catch (embeddingError) {
      console.error('Embedding generation failed:', embeddingError);
      // If embeddings fail, skip RAG ingestion but don't fail the entire message
      console.warn(`Skipping RAG ingestion for message ${messageId} due to embedding failure`);
      return;
    }

    if (!denseVectors || denseVectors.length === 0) {
      console.warn(`No embeddings generated for message ${messageId}, skipping RAG ingestion`);
      return;
    }

    // 3. Generate sparse vectors (BM25)
    const sparseVectors = chunks.map((c) => generateSparseVector(c.content));

    // 4. Prepare Qdrant points
    const points: RagPoint[] = chunks.map((chunk, idx) => ({
      id: uuidv4(),
      vector: denseVectors[idx]!,
      sparseVector: sparseVectors[idx]!,
      payload: {
        userId,
        conversationId,
        messageId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        timestamp: timestamp.toISOString(),
        isCode: chunk.isCode,
        role,
        modelUsed,
        profileTags,
      },
    }));

    // 5. Upsert to Qdrant
    const client = getQdrantClient();
    await client.upsert(COLLECTION_NAME, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: {
          '': p.vector,
          text: p.sparseVector,
        },
        payload: p.payload,
      })),
    });

    console.log(`✓ Ingested ${points.length} chunks for message ${messageId}`);
  } catch (error) {
    console.error('Ingestion error:', error);
    // Don't throw - log and continue
    // RAG is a nice-to-have feature, shouldn't break the main flow
    console.warn(`Failed to ingest message ${messageId}, continuing without RAG`);
  }
}

/**
 * Batch ingest multiple messages
 */
export async function batchIngestMessages(
  messages: Array<{
    userId: string;
    conversationId: string;
    messageId: string;
    content: string;
    role: 'user' | 'assistant';
    modelUsed?: string;
    timestamp?: Date;
  }>
): Promise<void> {
  const CONCURRENCY = 3;
  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const batch = messages.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((msg) => ingestMessage(msg)));
  }
  console.log(`✓ Batch ingestion attempted for ${messages.length} messages`);
}

/**
 * Delete all chunks for a conversation
 */
export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  try {
    const client = getQdrantClient();

    await client.delete(COLLECTION_NAME, {
      filter: {
        must: [
          { key: 'userId', match: { value: userId } },
          { key: 'conversationId', match: { value: conversationId } },
        ],
      },
    });

    console.log(`✓ Deleted chunks for conversation ${conversationId}`);
  } catch (error) {
    console.error('Failed to delete conversation from RAG:', error);
    // Don't throw - log and continue
  }
}

/**
 * Purge old data (privacy compliance)
 */
export async function purgeOldData(
  userId: string,
  daysOld: number = 30
): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const client = getQdrantClient();

    await client.delete(COLLECTION_NAME, {
      filter: {
        must: [
          { key: 'userId', match: { value: userId } },
          { key: 'timestamp', range: { lt: cutoffDate.toISOString() } },
        ],
      },
    });

    console.log(`✓ Purged data older than ${daysOld} days for user ${userId}`);
  } catch (error) {
    console.error('Failed to purge old data from RAG:', error);
    // Don't throw - log and continue
  }
}