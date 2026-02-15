// Extract: initializeQdrantCollection function
import { getQdrantClient } from './client';

export async function initializeCollection(collectionName: string) {
  const client = getQdrantClient();
  
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === collectionName);
  
  if (!exists) {
    await client.createCollection(collectionName, {
      vectors: { size: 1536, distance: 'Cosine' },
      sparse_vectors: { text: {} },
    });
    
    await createIndexes(collectionName);
  }
}

async function createIndexes(collectionName: string) {
  const client = getQdrantClient();
  
  await client.createPayloadIndex(collectionName, {
    field_name: 'userId',
    field_schema: 'keyword',
  });
  
  await client.createPayloadIndex(collectionName, {
    field_name: 'timestamp',
    field_schema: 'datetime',
  });
}