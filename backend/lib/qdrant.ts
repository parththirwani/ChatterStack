import { QdrantClient } from '@qdrant/js-client-rest';

let qdrantClient: QdrantClient | null = null;

export const getQdrantClient = (): QdrantClient => {
  if (!qdrantClient) {
    qdrantClient = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY,
    });
  }
  return qdrantClient;
};

export const initializeQdrantCollection = async () => {
  const client = getQdrantClient();
  const collectionName = process.env.QDRANT_COLLECTION || 'chatterstack_memory';

  try {
    // Check if collection exists
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === collectionName);

    if (!exists) {
      // Create collection with hybrid search support
      await client.createCollection(collectionName, {
        vectors: {
          size: 1536, // OpenAI text-embedding-3-small
          distance: 'Cosine',
        },
        sparse_vectors: {
          text: {}, // BM25 sparse vectors
        },
      });

      // Create payload index for filtering
      await client.createPayloadIndex(collectionName, {
        field_name: 'userId',
        field_schema: 'keyword',
      });

      await client.createPayloadIndex(collectionName, {
        field_name: 'timestamp',
        field_schema: 'datetime',
      });

      console.log(`✓ Qdrant collection '${collectionName}' created`);
    } else {
      console.log(`✓ Qdrant collection '${collectionName}' already exists`);
    }
  } catch (error) {
    console.error('Failed to initialize Qdrant collection:', error);
    throw error;
  }
};