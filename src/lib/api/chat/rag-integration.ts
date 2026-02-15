import crypto from 'crypto';
import { ingestMessage } from '@/src/services/rag/ingest';
import { incrementalProfileUpdate } from '@/src/services/profile/profiler';
import { retrieveContextWithFallback, formatContextForLLM } from '@/src/services/rag/retrievalService';

const RAG_ENABLED = process.env.RAG_ENABLED === 'true';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}

export async function retrieveRAGContext(
  userId: string,
  query: string,
  conversationId: string,
  conversationHistory: ConversationMessage[]
): Promise<string> {
  if (!RAG_ENABLED) {
    return '';
  }

  try {
    const context = await retrieveContextWithFallback({
      userId,
      query,
      currentConversationId: conversationId,
      shortTermMessages: conversationHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return formatContextForLLM(context);
  } catch (error) {
    console.error('RAG retrieval failed:', error);
    return '';
  }
}

export async function ingestConversationData(
  userId: string,
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  selectedModel: string
) {
  if (!RAG_ENABLED) return;

  const userMessageId = crypto.randomUUID();
  const aiMessageId = crypto.randomUUID();

  // Ingest user message
  ingestMessage({
    userId,
    conversationId,
    messageId: userMessageId,
    content: userMessage,
    role: 'user',
  }).catch((err) => console.error('User message ingestion failed:', err));

  // Ingest AI response
  ingestMessage({
    userId,
    conversationId,
    messageId: aiMessageId,
    content: aiResponse,
    role: 'assistant',
    modelUsed: selectedModel === 'council'
      ? `council:google/gemini-3-pro-preview`
      : selectedModel,
  }).catch((err) => console.error('AI message ingestion failed:', err));

  // Update profile
  incrementalProfileUpdate(userId, {
    role: 'user',
    content: userMessage,
  }).catch((err) => console.error('Profile update failed:', err));
}