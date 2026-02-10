import { getQdrantClient } from '../../lib/qdrant';
import { generateEmbeddings } from '../embedding/openrouter';
import { chunkMessage } from './chunker';
import { generateSparseVector } from './sparse';
import type { RagChunk, RagPoint } from './types';
import { v4 as uuidv4 } from 'uuid';

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'chatterstack_memory';

/**
 * Ingest a message into the RAG system
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
    const chunkTexts = chunks.map(c => c.content);
    const denseVectors = await generateEmbeddings(chunkTexts);

    if (!denseVectors || denseVectors.length === 0) {
      throw new Error('Failed to generate embeddings');
    }

    // 3. Generate sparse vectors (BM25)
    const sparseVectors = chunks.map(c => generateSparseVector(c.content));

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
      points: points.map(p => ({
        id: p.id,
        vector: {
          '': p.vector, // Default vector name
          text: p.sparseVector, // Sparse vector
        },
        payload: p.payload,
      })),
    });

    console.log(`✓ Ingested ${points.length} chunks for message ${messageId}`);
  } catch (error) {
    console.error('Ingestion error:', error);
    throw error;
  }
}

/**
 * Batch ingest multiple messages (e.g., on conversation load)
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
  // Ingest in parallel with concurrency limit
  const CONCURRENCY = 3;
  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const batch = messages.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(msg => ingestMessage(msg)));
  }
  console.log(`✓ Batch ingested ${messages.length} messages`);
}

/**
 * Delete all chunks for a conversation
 */
export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
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
}

/**
 * Purge old data (privacy compliance)
 */
export async function purgeOldData(userId: string, daysOld: number = 30): Promise<void> {
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
}