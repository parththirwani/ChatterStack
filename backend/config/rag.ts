export const RAG_CONFIG = {
  // Qdrant
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
    collection: process.env.QDRANT_COLLECTION || 'chatterstack_memory',
  },
  
  // Embeddings
  embedding: {
    model: process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small',
    cacheTTL: parseInt(process.env.OPENROUTER_EMBEDDING_CACHE_TTL || '86400', 10),
    batchSize: 10,
  },
  
  // Chunking
  chunking: {
    chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '600', 10),
    chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '100', 10),
  },
  
  // Retrieval
  retrieval: {
    topKDense: parseInt(process.env.RAG_TOP_K_DENSE || '10', 10),
    topKSparse: parseInt(process.env.RAG_TOP_K_SPARSE || '10', 10),
    topKFinal: parseInt(process.env.RAG_TOP_K_FINAL || '5', 10),
    timeWindowDays: parseInt(process.env.RAG_TIME_WINDOW_DAYS || '90', 10),
    enableReranker: process.env.RAG_ENABLE_RERANKER === 'true',
  },
  
  // Profile
  profile: {
    updateThreshold: parseInt(process.env.PROFILE_UPDATE_THRESHOLD || '5', 10),
    refreshCron: process.env.PROFILE_REFRESH_CRON || '0 2 * * *',
  },
  
  // Feature flags
  enabled: process.env.RAG_ENABLED === 'true',
};

export default RAG_CONFIG;