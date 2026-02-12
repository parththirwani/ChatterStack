export interface RagChunk {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  content: string;
  chunkIndex: number;
  isCode: boolean;
  timestamp: Date;
  modelUsed?: string;
  profileTags?: string[];
}

export interface RagPoint {
  id: string;
  vector: number[];
  payload: {
    userId: string;
    conversationId: string;
    messageId: string;
    chunkIndex: number;
    content: string;
    timestamp: string;
    isCode: boolean;
    modelUsed?: string;
    profileTags?: string[];
  };
  // Sparse vector for BM25
  sparseVector?: {
    indices: number[];
    values: number[];
  };
}

export interface RetrievalContext {
  chunks: Array<{
    content: string;
    score: number;
    conversationId: string;
    timestamp: string;
    isCode: boolean;
  }>;
  shortTermContext: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface HybridSearchResult {
  id: string;
  score: number;
  payload: RagPoint['payload'];
}