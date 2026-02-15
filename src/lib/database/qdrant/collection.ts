import { getQdrantClient } from './client';

export async function initializeCollection(collectionName: string) {
  try {
    const client = getQdrantClient();
    
    // Check if collection exists
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === collectionName);
    
    if (!exists) {
      console.log(`Creating Qdrant collection: ${collectionName}`);
      
      // Create collection with vectors
      await client.createCollection(collectionName, {
        vectors: { 
          size: 1536,  // OpenAI embedding size
          distance: 'Cosine' 
        },
        sparse_vectors: { 
          text: {} 
        },
      });
      
      console.log(`✓ Collection '${collectionName}' created`);
      
      // Create indexes for better performance
      await createIndexes(collectionName);
    } else {
      console.log(`✓ Collection '${collectionName}' already exists`);
    }
  } catch (error) {
    console.error('Failed to initialize Qdrant collection:', error);
    throw error;
  }
}

async function createIndexes(collectionName: string) {
  try {
    const client = getQdrantClient();
    
    // Create payload indexes for filtering
    await client.createPayloadIndex(collectionName, {
      field_name: 'userId',
      field_schema: 'keyword',
    });
    
    await client.createPayloadIndex(collectionName, {
      field_name: 'timestamp',
      field_schema: 'datetime',
    });
    
    console.log(`✓ Indexes created for '${collectionName}'`);
  } catch (error) {
    console.error('Failed to create indexes:', error);
    // Don't throw - indexes are optional for functionality
  }
}

/**
 * Initialize Qdrant (legacy function name for compatibility)
 */
export async function initializeQdrantCollection() {
  const collectionName = process.env.QDRANT_COLLECTION || 'chatterstack_memory';
  return await initializeCollection(collectionName);
}