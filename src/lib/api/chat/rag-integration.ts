import crypto from 'crypto';
import { ingestMessage } from '@/src/services/rag/ingest';
import { incrementalProfileUpdate } from '@/src/services/profile/profiler';
import { retrieveContextWithFallback, formatContextForLLM } from '@/src/services/rag/retrievalService';
import { captureError } from '@/src/lib/observability/capture';

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
  conversationHistory: ConversationMessage[],
  traceId?: string
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
      traceId,
    });

    return formatContextForLLM(context);
  } catch (error) {
    captureError(error, { route: 'chat/rag', stage: 'retrieve' });
    return '';
  }
}

export async function ingestConversationData(
  userId: string,
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  selectedModel: string,
  traceId?: string
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
    traceId,
  }).catch((err) => captureError(err, { route: 'chat/rag', stage: 'ingest-user' }));

  // Ingest AI response
  ingestMessage({
    userId,
    conversationId,
    messageId: aiMessageId,
    content: aiResponse,
    role: 'assistant',
    modelUsed: selectedModel,
    traceId,
  }).catch((err) => captureError(err, { route: 'chat/rag', model: selectedModel, stage: 'ingest-assistant' }));

  // Update profile
  incrementalProfileUpdate(userId, {
    role: 'user',
    content: userMessage,
  }).catch((err) => captureError(err, { route: 'chat/rag', stage: 'profile-update' }));
}
