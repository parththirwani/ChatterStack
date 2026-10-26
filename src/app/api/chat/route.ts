import { NextRequest } from 'next/server';
import { auth } from '@/src/lib/auth';
import { redisStore } from '@/src/lib/redis';
import crypto from 'crypto';
import { runCouncilProcess } from '@/src/services/council/councilService';
import { createEmptyConversation, addMessagesToConversation } from '@/src/lib/api/chat/conversation-persistance';
import { generateConversationTitle, saveGeneratedTitle } from '@/src/services/title/titleService';
import { createCompletion } from '@/src/lib/api/chat/openrouter';
import { retrieveRAGContext, ingestConversationData } from '@/src/lib/api/chat/rag-integration';
import { createSSEStream, type SSEStream } from '@/src/lib/api/chat/sse-helper';
import { beginConversationTurn } from '@/src/lib/api/chat/conversation-turns';
import { prisma } from '@/src/lib/prisma';

import { withLLMTokenLimit, recordLLMTokens, countTokens, estimatePromptTokens } from '@/src/middleware/llmTokenRateLimit';
import { ChatRequestSchema } from '@/src/types/chat.types';
import { DEFAULT_THINKING_LEVEL } from '@/src/config/models';
import { attachmentParts, messageContent } from '@/src/lib/api/chat/attachments';
import type { ChatAttachment } from '@/src/types/chat.types';
import type { DocumentAttachment } from '@/src/types/chat.types';
import { markDocumentsUsed, resolveDocuments } from '@/src/lib/server/documents';

interface RedisMessage {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  attachments?: Array<ChatAttachment | DocumentAttachment>;
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

/** Cached history, falling back to the database (and refilling the cache in one write). */
async function loadHistory(conversationId: string): Promise<RedisMessage[]> {
  const cached = await redisStore.get(conversationId);
  if (cached.length > 0) return cached;

  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, modelId: true, attachments: true },
  });
  const history: RedisMessage[] = rows.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    modelId: m.modelId ?? undefined,
    attachments: Array.isArray(m.attachments) ? m.attachments as unknown as Array<ChatAttachment | DocumentAttachment> : undefined,
  }));
  // Binary payloads can be several MB each. Keep those conversations in Postgres,
  // rather than copying the entire history into Redis on every turn.
  if (history.length > 0 && history.every((message) => !message.attachments?.length)) {
    await redisStore.set(conversationId, history);
  }
  return history;
}

async function historyAttachmentParts(userId: string, files: Array<ChatAttachment | DocumentAttachment>) {
  const parts = [];
  for (const file of files) {
    if ('data' in file && typeof file.data === 'string') {
      parts.push(...await attachmentParts([file]));
    } else if ('documentId' in file && file.documentId) {
      const resolved = await resolveDocuments(userId, [file as DocumentAttachment], true);
      if (resolved.length) parts.push(...await attachmentParts(resolved));
      else parts.push({ type: 'text' as const, text: `Previously attached file "${file.name}" was removed.` });
    }
  }
  return parts;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return jsonError('Unauthorized', 401);
    }

    const userId = session.user.id;
    const body = await request.json();

    const { success, data, error: validationError } =
      ChatRequestSchema.safeParse(body);
    if (!success) {
      return new Response(
        JSON.stringify({
          message: 'Incorrect inputs',
          errors: validationError?.issues,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // New chats normally arrive with a client-generated id so the client can
    // show and route to them before the first answer finishes.
    const isNewConversation = data.newConversation === true || !data.conversationId;
    const conversationId = data.conversationId ?? crypto.randomUUID();
    const selectedModel = data.selectedModel;
    const isCouncilMode = selectedModel === 'council';
    const thinkingLevel = data.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
    const attachments = data.attachments ?? [];
    let currentParts;
    try {
      const resolved = await resolveDocuments(userId, attachments);
      currentParts = await attachmentParts(resolved);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Invalid attachment', 400);
    }

    // Check (or claim) the conversation before streaming anything: the id
    // comes from the client, so it must belong to this user. Ownership is
    // verified before any history is read or budget is reserved.
    if (!isNewConversation) {
      const owned = await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true },
      });
      if (!owned) return jsonError('Conversation not found', 404);
    }

    // The limit is estimated from the full prompt the model will see:
    // cached history + the new message + current attachment text. The
    // reservation is reconciled with the actual usage in `respond` below.
    const historyForEstimate = isNewConversation ? [] : await loadHistory(conversationId);
    const estimateText = [
      ...historyForEstimate.map((m) => m.content),
      data.message,
      ...currentParts.filter((part) => part.type === 'text').map((part) => part.text),
    ].join('\n');

    const rateLimitCheck = await withLLMTokenLimit(userId, estimateText, isCouncilMode);
    if (rateLimitCheck) {
      return rateLimitCheck; // Returns 429 (or 503) with detailed token info
    }

    // Claim a new chat only once the budget is reserved; a rejected claim
    // releases the reservation again (0 tokens) so it is not wasted.
    if (isNewConversation) {
      try {
        await createEmptyConversation(conversationId, userId);
      } catch (error) {
        if (isUniqueViolation(error)) {
          await recordLLMTokens(userId, 0, isCouncilMode).catch(() => {});
          return jsonError('Conversation already exists', 409);
        }
        await recordLLMTokens(userId, 0, isCouncilMode).catch(() => {});
        throw error;
      }
    }

    const respond = async ({ send, signal }: SSEStream) => {
      // The reservation from withLLMTokenLimit above must never be left
      // dangling: whichever path `respond` exits through, usage is recorded.
      let usageRecorded = false;
      try {
      send({ status: 'starting' });

      // A new chat is named in parallel with the answer, so the sidebar can
      // show its real title while it streams.
      let titleTask: Promise<void> = Promise.resolve();
      if (isNewConversation) {
        send({ conversationCreated: conversationId });
        titleTask = generateConversationTitle({ userMessage: data.message || `Attached ${attachments.map((file) => file.name).join(', ')}` })
          .then(async (title) => {
            // Saved even if the client has gone; only sent if it's still there.
            if (await saveGeneratedTitle(conversationId, title)) send({ title });
          })
          .catch((err) => console.error('Title generation failed:', err));
      }

      const conversationHistory = isNewConversation ? [] : await loadHistory(conversationId);

      const ragContext = await retrieveRAGContext(
        userId,
        data.message,
        conversationId,
        conversationHistory
      );

      const messagesForAI = await Promise.all([
        ...conversationHistory,
        { role: 'user' as const, content: data.message, attachments },
      ].map(async (m, index) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: messageContent(m.content, index === conversationHistory.length ? currentParts : await historyAttachmentParts(userId, m.attachments ?? [])),
      })));

      if (ragContext) {
        const lastMessage = messagesForAI[messagesForAI.length - 1];
        const context = `Context from past conversations:\n\n${ragContext}\n\n---\n\nCurrent question: ${data.message}`;
        lastMessage.content = messageContent(context, currentParts);
      }

      // On Stop/disconnect the model call is cancelled and resolves with the
      // text written so far, which is still saved and counted below.
      let fullContent = '';
      try {
        fullContent = isCouncilMode
          ? await runCouncilProcess(
              data.message,
              // Members see earlier files too; the chair's prompt uses the text.
              conversationHistory.map((m, index) => ({ ...m, parts: messagesForAI[index].content })),
              { members: data.council?.members, chair: data.council?.chair, thinkingLevel, signal },
              {
                onProgress: (stage, model, progress) => send({ status: 'progress', stage, model, progress }),
                onChunk: (chunk) => send({ chunk }),
                onReasoning: (reasoning) => send({ reasoning }),
                onAnswer: (councilAnswer) => send({ councilAnswer }),
                onRankings: (councilRankings) => send({ councilRankings }),
              },
              currentParts
            )
          : await createCompletion(messagesForAI, selectedModel, {
              thinkingLevel,
              signal,
              onChunk: (chunk) => send({ chunk }),
              onReasoning: (reasoning) => send({ reasoning }),
            });
        send({ done: true });
      } catch (error) {
        if (!signal.aborted) {
          console.error('Model call failed:', error);
          send({
            error: error instanceof Error ? error.message : 'Failed to generate response',
          });
        }
      }

      // Count every call, including stopped and failed ones: the prompt was
      // still sent, and skipping this would let Stop bypass the rate limit.
      try {
        usageRecorded = true;
        const inputTokens = countTokens(messagesForAI.map((m) => typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')).join('\n'));
        await recordLLMTokens(userId, inputTokens + countTokens(fullContent), isCouncilMode);
      } catch (error) {
        console.error('Failed to record tokens:', error);
      }

      const exchange: RedisMessage[] = [
        { role: 'user', content: data.message, attachments },
        ...(fullContent ? [{ role: 'assistant' as const, content: fullContent, modelId: selectedModel }] : []),
      ];
      if ([...conversationHistory, ...exchange].every((message) => !message.attachments?.length)) {
        await redisStore.set(conversationId, [...conversationHistory, ...exchange]);
      } else {
        await redisStore.delete(conversationId);
      }
      await addMessagesToConversation(conversationId, data.message, fullContent, selectedModel, attachments);
      await markDocumentsUsed(userId, attachments);
      if (fullContent) {
        await ingestConversationData(userId, conversationId, data.message, fullContent, selectedModel);
      }

      // Usually finished long before the answer; bounded by the title timeout.
      await titleTask;
      } finally {
        if (!usageRecorded) {
          // Failed before the model call (e.g. RAG or attachment setup):
          // settle the reservation with the estimate so it is not stuck
          // against the window for 24 hours.
          await recordLLMTokens(userId, estimatePromptTokens(estimateText, isCouncilMode), isCouncilMode).catch((error) =>
            console.error('Failed to release token reservation:', error)
          );
        }
      }
    };

    const turn = beginConversationTurn(conversationId);
    return createSSEStream(async (stream) => {
      try {
        await turn.ready;
        await respond(stream);
      } finally {
        turn.end();
      }
    }, request.signal);
  } catch (error) {
    console.error('Error in chat:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
