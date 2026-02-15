import { QdrantClient } from '@qdrant/js-client-rest';

let qdrantClient: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!qdrantClient) {
    // PRIORITY: Check for Qdrant Cloud credentials first
    const qdrantUrl = process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT;
    const qdrantApiKey = process.env.QDRANT_API_KEY;
    
    if (!qdrantUrl) {
      console.warn(' No Qdrant configuration found - RAG features will be limited');
      // Return a dummy client that will fail gracefully
      throw new Error('Qdrant not configured');
    }

    const isCloud = qdrantUrl.includes('qdrant.io') || qdrantUrl.includes('qdrant.tech') || !!qdrantApiKey;

    if (isCloud) {
      
      if (!qdrantApiKey) {
        console.warn(' Qdrant Cloud URL detected but no API key provided');
      }

      qdrantClient = new QdrantClient({
        url: qdrantUrl,
        apiKey: qdrantApiKey,
      });
      
    } else {
      
      qdrantClient = new QdrantClient({
        url: qdrantUrl,
      });
      
    }
  }
  
  return qdrantClient;
}

/**
 * Test Qdrant connection
 */
export async function testQdrantConnection(): Promise<boolean> {
  try {
    const client = getQdrantClient();
    await client.getCollections();
    return true;
  } catch (error) {
    console.error('⚠️  Qdrant connection failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Get connection info
 */
export function getQdrantConnectionInfo(): { isCloud: boolean; url: string | undefined } {
  const qdrantUrl = process.env.QDRANT_URL || process.env.QDRANT_ENDPOINT;
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const isCloud = !!qdrantUrl && (qdrantUrl.includes('qdrant.io') || qdrantUrl.includes('qdrant.tech') || !!qdrantApiKey);
  
  return {
    isCloud,
    url: qdrantUrl,
  };
}