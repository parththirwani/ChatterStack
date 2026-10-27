import crypto from 'crypto';
import { ingestMessage, type IngestOutcome } from '@/src/services/rag/ingest';
import { incrementalProfileUpdate } from '@/src/services/profile/profiler';
import { retrieveContextWithFallback, formatContextForLLM } from '@/src/services/rag/retrievalService';
import { captureError } from '@/src/lib/observability/capture';
import { traceStep } from '@/src/lib/observability/otlp-traces';

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
    const context = await traceStep(traceId, 'rag.retrieve', () => retrieveContextWithFallback({
      userId,
      query,
      currentConversationId: conversationId,
      shortTermMessages: conversationHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      traceId,
    }), (result) => ({
      'chatterstack.rag_chunks': result.chunks?.length ?? 0,
      'chatterstack.rag_context_found': (result.chunks?.length ?? 0) > 0,
      'chatterstack.rag_degraded': result.degraded === true,
    }), (result) => result.degraded === true);

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

  // Each write is its own span (with its embedding call nested inside), so a
  // slow or failing memory store shows up in the request's trace.
  const ingestStep = (role: 'user' | 'assistant', run: () => Promise<IngestOutcome>) =>
    traceStep(traceId, 'rag.ingest', run, (outcome) => ({
      'chatterstack.rag_role': role,
      'chatterstack.rag_outcome': outcome,
    }), (outcome) => outcome === 'failed');

  // Ingest user message
  ingestStep('user', () => ingestMessage({
    userId,
    conversationId,
    messageId: userMessageId,
    content: userMessage,
    role: 'user',
    traceId,
  })).catch((err) => captureError(err, { route: 'chat/rag', stage: 'ingest-user' }));

  // Ingest AI response
  ingestStep('assistant', () => ingestMessage({
    userId,
    conversationId,
    messageId: aiMessageId,
    content: aiResponse,
    role: 'assistant',
    modelUsed: selectedModel,
    traceId,
  })).catch((err) => captureError(err, { route: 'chat/rag', model: selectedModel, stage: 'ingest-assistant' }));

  // Update profile
  traceStep(traceId, 'profile.update', () => incrementalProfileUpdate(userId, {
    role: 'user',
    content: userMessage,
  })).catch((err) => captureError(err, { route: 'chat/rag', stage: 'profile-update' }));
}
