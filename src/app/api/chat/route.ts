import { NextRequest } from 'next/server';
import { auth } from '@/src/lib/auth';
import { redisStore } from '@/src/lib/redis';
import crypto from 'crypto';
import { runCouncilProcess } from '@/src/services/council/councilService';
import { createEmptyConversation, addMessagesToConversation, deleteLastExchange } from '@/src/lib/api/chat/conversation-persistance';
import { generateConversationTitle, saveGeneratedTitle } from '@/src/services/title/titleService';
import { createCompletion } from '@/src/lib/api/chat/openrouter';
import { retrieveRAGContext, ingestConversationData } from '@/src/lib/api/chat/rag-integration';
import { createSSEStream, type SSEStream } from '@/src/lib/api/chat/sse-helper';
import { beginConversationTurn } from '@/src/lib/api/chat/conversation-turns';
import { prepareModelContext } from '@/src/lib/api/chat/model-context';
import { dropSnapshotIfBoundaryMissing } from '@/src/lib/api/chat/context-snapshot';
import type { CompactionInfo, ContextMessage } from '@/src/lib/api/chat/model-context';
import { truncateToTokenBudget } from '@/src/lib/api/chat/prompt-budget';
import { prisma } from '@/src/lib/prisma';
import { MESSAGE_ORDER } from '@/src/lib/server/message-order';

import { countTokens } from '@/src/lib/tokens';
import { captureError } from '@/src/lib/observability/capture';
import { recordRequestSpan, traceStep } from '@/src/lib/observability/otlp-traces';
import { AnalyticsEvents, chatMessageRetriedProps, chatMessageSentProps, chatResponseCompletedProps, councilRunCompletedProps, type ChatResponseOutcome } from '@/src/lib/analytics/events';
import { captureServerEvent } from '@/src/lib/analytics/posthog-server';
import { ChatRequestSchema } from '@/src/types/chat.types';
import { COUNCIL_MODEL_IDS, DEFAULT_THINKING_LEVEL, TITLE_MODEL } from '@/src/config/models';
import { attachmentParts, messageContent } from '@/src/lib/api/chat/attachments';
import type { ChatAttachment } from '@/src/types/chat.types';
import type { DocumentAttachment } from '@/src/types/chat.types';
import type { CompletionAnalytics, ModelTiming } from '@/src/types/chat.types';
import { markDocumentsUsed, resolveDocuments } from '@/src/lib/server/documents';
import { resolveSkills, SkillError, skillTags } from '@/src/lib/server/skills';
import { formatActiveSkills } from '@/src/services/prompt/promptService';

interface RedisMessage {
  /** The saved Message row id; the compaction boundary refers to it. */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  attachments?: Array<ChatAttachment | DocumentAttachment>;
  createdAt?: string;
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
async function loadHistory(conversationId: string, dropLastExchange = false): Promise<RedisMessage[]> {
  const cached = await redisStore.get(conversationId);
  let history: RedisMessage[] = cached.length > 0 ? cached : await readMessages(conversationId);

  // Caches written before compaction existed have no message ids, so they
  // cannot serve as a stable summary boundary. Refill once from Postgres.
  if (cached.length > 0 && cached.some((message) => !message.id)) {
    const fresh = await readMessages(conversationId);
    if (fresh.length >= cached.length) {
      history = fresh;
      if (fresh.every((message) => !message.attachments?.length)) {
        await redisStore.set(conversationId, fresh);
      }
    }
  }

  if (cached.length === 0 && history.length > 0 && history.every((message) => !message.attachments?.length)) {
    // Binary payloads can be several MB each. Keep those conversations in Postgres,
    // rather than copying the entire history into Redis on every turn.
    await redisStore.set(conversationId, history);
  }

  if (!dropLastExchange) return history;
  // A retry replaces the last exchange, so the model must not see it twice:
  // drop its answer (if there was one) and the question it answered.
  const trimmed = history.slice();
  if (trimmed.at(-1)?.role === 'assistant') trimmed.pop();
  if (trimmed.at(-1)?.role === 'user') trimmed.pop();
  return trimmed;
}

async function readMessages(conversationId: string): Promise<RedisMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: MESSAGE_ORDER,
    select: { id: true, role: true, content: true, modelId: true, attachments: true, createdAt: true },
  });
  return rows.map((m) => ({
    id: m.id ?? undefined,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    modelId: m.modelId ?? undefined,
    attachments: Array.isArray(m.attachments) ? m.attachments as unknown as Array<ChatAttachment | DocumentAttachment> : undefined,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : undefined,
  }));
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
  // One id for every model call this request makes, so the council stages and the
  // embedding calls can be joined back together in OpenObserve.
  const traceId = crypto.randomUUID();
  const requestStartedAt = Date.now();
  const traced: { userId?: string; model?: string; council?: boolean; conversationId?: string } = {};
  // A request answered without streaming (rejected, or failed before the stream)
  // still gets a root-only trace, so throttled and refused requests are visible.
  const finish = (response: Response, error?: unknown, attributes?: Parameters<typeof recordRequestSpan>[0]['attributes']) => {
    recordRequestSpan({
      traceId,
      startedAt: requestStartedAt,
      status: response.status >= 500 ? 'error' : 'rejected',
      httpStatus: response.status,
      error,
      attributes,
      ...traced,
    });
    return response;
  };

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return finish(jsonError('Unauthorized', 401));
    }

    const userId = session.user.id;
    traced.userId = userId;
    // A body that is not JSON is the client's mistake, not a server error.
    const body = await request.json().catch(() => undefined);
    if (body === undefined) return finish(jsonError('Request body must be valid JSON', 400));

    const { success, data, error: validationError } =
      ChatRequestSchema.safeParse(body);
    if (!success) {
      return finish(new Response(
        JSON.stringify({
          message: 'Incorrect inputs',
          errors: validationError?.issues,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      ));
    }

    // New chats normally arrive with a client-generated id so the client can
    // show and route to them before the first answer finishes.
    const isNewConversation = data.newConversation === true || !data.conversationId;
    const conversationId = data.conversationId ?? crypto.randomUUID();
    const selectedModel = data.selectedModel;
    const isCouncilMode = selectedModel === 'council';
    const thinkingLevel = data.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
    const attachments = data.attachments ?? [];
    // Retry regenerates the last answer, so the exchange it replaces is dropped
    // from the history and from storage instead of piling up behind it.
    const isRetry = data.retry === true && !isNewConversation;
    traced.model = selectedModel;
    traced.council = isCouncilMode;
    traced.conversationId = conversationId;
    let currentParts;
    try {
      const resolved = await resolveDocuments(userId, attachments);
      currentParts = await attachmentParts(resolved);
    } catch (error) {
      return finish(jsonError(error instanceof Error ? error.message : 'Invalid attachment', 400));
    }
    let skills;
    try {
      skills = await resolveSkills(userId, data.skills ?? []);
    } catch (error) {
      if (error instanceof SkillError) return finish(jsonError(error.message, error.status));
      throw error;
    }
    // Sent in the system prompt, so it counts toward the prompt like the message.
    const skillText = formatActiveSkills(skills);

    // Check (or claim) the conversation before streaming anything: the id
    // comes from the client, so it must belong to this user. Ownership is
    // verified before any history is read.
    if (!isNewConversation) {
      const owned = await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true },
      });
      if (!owned) return finish(jsonError('Conversation not found', 404));
    }

    // Planning and compaction both need the latest
    // history, so they run under the conversation turn lock before streaming.
    // A refusal still gets a normal HTTP status instead of an SSE error.
    const turn = beginConversationTurn(conversationId);
    let prepared!: {
      history: ContextMessage[];
      rawHistory: RedisMessage[];
      messageWithRag: string;
      ragUsed: boolean;
      usage: { input: number; output: number };
      compaction?: CompactionInfo;
    };

    try {
      await turn.ready;
      const rawHistory = isNewConversation ? [] : await loadHistory(conversationId, isRetry);

      // Retrieval still reads the full saved transcript; only the model view
      // is compacted. The excerpt is bounded so RAG cannot blow the budget.
      const ragContext = await retrieveRAGContext(
        userId,
        data.message,
        conversationId,
        rawHistory,
        traceId
      );
      const ragText = ragContext ? truncateToTokenBudget(ragContext, 4_000) : '';
      const messageWithRag = ragText
        ? `Context from past conversations:\n\n${ragText}\n\n---\n\nCurrent question: ${data.message}`
        : data.message;

      const context = await prepareModelContext({
        userId,
        conversationId,
        history: rawHistory,
        message: data.message,
        messageWithRag,
        currentParts,
        model: selectedModel,
        thinkingLevel,
        isCouncil: isCouncilMode,
        council: data.council,
        skills,
        signal: request.signal,
        isRetry,
        trace: { traceId, userId, conversationId },
      });

      if (!context.ok) {
        turn.end();
        // A summarizer call may already have run before the turn was refused.
        return finish(jsonError(context.error, context.status), undefined, context.usage.input + context.usage.output > 0 ? {
          'chatterstack.compaction_input_tokens': context.usage.input,
          'chatterstack.compaction_output_tokens': context.usage.output,
        } : undefined);
      }

      prepared = {
        history: context.history,
        rawHistory,
        messageWithRag,
        ragUsed: Boolean(ragContext),
        usage: context.usage,
        compaction: context.compaction,
      };

      captureServerEvent(userId, AnalyticsEvents.ChatMessageSent, chatMessageSentProps({
        modelId: selectedModel,
        council: isCouncilMode,
        thinkingLevel,
        attachmentCount: attachments.length,
        messageLength: data.message?.length ?? 0,
      }));
      if (isRetry) {
        captureServerEvent(userId, AnalyticsEvents.ChatMessageRetried, chatMessageRetriedProps({
          modelId: selectedModel,
          council: isCouncilMode,
          thinkingLevel,
        }));
      }

      // Claim a new chat only once the context is ready.
      if (isNewConversation) {
        try {
          await createEmptyConversation(conversationId, userId);
          captureServerEvent(userId, AnalyticsEvents.ConversationCreated, { council: isCouncilMode });
        } catch (error) {
          turn.end();
          if (isUniqueViolation(error)) return finish(jsonError('Conversation already exists', 409));
          throw error;
        }
      }
    } catch (error) {
      turn.end();
      throw error;
    }

    const respond = async ({ send, signal }: SSEStream) => {
      // The request's root span in OpenObserve traces: question, answer, outcome.
      let requestAnswer = '';
      let requestStatus: 'ok' | 'error' | 'aborted' = 'error';
      let requestError: unknown;
      const requestRagUsed = prepared.ragUsed;
      try {
      send({ status: 'starting' });
      if (prepared.compaction) {
        send({
          contextCompacted: {
            throughMessageId: prepared.compaction.throughMessageId,
            inputTokensBefore: prepared.compaction.inputTokensBefore,
            inputTokensAfter: prepared.compaction.inputTokensAfter,
            summaryTokens: prepared.compaction.summaryTokens,
          },
        });
      }

      // A new chat is named in parallel with the answer, so the sidebar can
      // show its real title while it streams.
      let titleTask: Promise<void> = Promise.resolve();
      if (isNewConversation) {
        send({ conversationCreated: conversationId });
        titleTask = generateConversationTitle({ trace: { traceId, userId, conversationId }, userMessage: data.message || `Attached ${attachments.map((file) => file.name).join(', ')}` })
          .then(async (title) => {
            // Saved even if the client has gone; only sent if it's still there.
            if (await saveGeneratedTitle(conversationId, title)) send({ title });
          })
          .catch((err) => captureError(err, { route: '/api/chat', model: TITLE_MODEL, council: isCouncilMode, stage: 'title', userId }));
      }

      const conversationHistory = prepared.history;

      const messagesForAI = await Promise.all([
        ...conversationHistory,
        { role: 'user' as const, content: prepared.messageWithRag, attachments },
      ].map(async (m, index) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: messageContent(m.content, index === conversationHistory.length ? currentParts : await historyAttachmentParts(userId, (m.attachments ?? []) as Array<ChatAttachment | DocumentAttachment>)),
      })));

      // On Stop/disconnect the model call is cancelled and resolves with the
      // text written so far, which is still saved below.
      let fullContent = '';
      const modelStartedAt = Date.now();
      // Council mode measures every member call, so the total can be broken
      // down per model in the UI.
      const timings: ModelTiming[] = [];
      const promptText = messagesForAI
        .map((m) => typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'))
        .join('\n');
      let outcome: ChatResponseOutcome = 'success';
      try {
        fullContent = isCouncilMode
          ? await runCouncilProcess(
              prepared.messageWithRag,
              // Members see earlier files too; the chair's prompt uses the text.
              conversationHistory.map((m, index) => ({ ...m, parts: messagesForAI[index].content })),
              {
                members: data.council?.members,
                chair: data.council?.chair,
                thinkingLevel,
                signal,
                skills,
                trace: { traceId, inRequest: true, contentPrompt: data.message, userId, conversationId, ragUsed: requestRagUsed, attachmentCount: attachments.length },
              },
              {
                onProgress: (stage, model, progress) => send({ status: 'progress', stage, model, progress }),
                onChunk: (chunk) => send({ chunk }),
                onReasoning: (reasoning) => send({ reasoning }),
                onAnswer: (councilAnswer) => send({ councilAnswer }),
                onRankings: (councilRankings) => send({ councilRankings }),
                onTiming: (timing) => timings.push(timing),
              },
              currentParts
            )
          : await createCompletion(messagesForAI, selectedModel, {
              thinkingLevel,
              signal,
              skills,
              onChunk: (chunk) => send({ chunk }),
              onReasoning: (reasoning) => send({ reasoning }),
              trace: {
                traceId,
                inRequest: true,
                contentPrompt: data.message,
                span: 'completion',
                userId,
                conversationId,
                thinkingLevel,
                messageCount: messagesForAI.length,
                attachmentCount: attachments.length,
                ragUsed: requestRagUsed,
              },
            });
        // Tokens and timing of the reply that just finished, for the client to
        // show under it. A counting failure must never lose the answer.
        try {
          const input = countTokens(skillText) + countTokens(promptText) + prepared.usage.input;
          const output = countTokens(fullContent) + prepared.usage.output;
          const analytics: CompletionAnalytics = {
            durationMs: Date.now() - modelStartedAt,
            inputTokens: input,
            outputTokens: output,
            totalTokens: input + output,
            ...(isCouncilMode && timings.length > 0 ? { timings } : {}),
          };
          send({ analytics });
        } catch (error) {
          captureError(error, { route: '/api/chat', model: selectedModel, council: isCouncilMode, stage: 'analytics', userId });
        }
        send({ done: true });
      } catch (error) {
        outcome = signal.aborted ? 'stopped' : 'error';
        requestError = error;
        if (!signal.aborted) {
          captureError(error, { route: '/api/chat', model: selectedModel, council: isCouncilMode, stage: 'model-call', userId });
          send({
            error: error instanceof Error ? error.message : 'Failed to generate response',
          });
        }
      }
      if (signal.aborted && outcome === 'success') outcome = 'stopped';
      requestAnswer = fullContent;
      requestStatus = outcome === 'success' ? 'ok' : outcome === 'stopped' ? 'aborted' : 'error';

      captureServerEvent(userId, AnalyticsEvents.ChatResponseCompleted, chatResponseCompletedProps({
        modelId: selectedModel, council: isCouncilMode, startedAt: modelStartedAt, outcome,
      }));
      if (isCouncilMode) {
        captureServerEvent(userId, AnalyticsEvents.CouncilRunCompleted, councilRunCompletedProps({
          members: data.council?.members?.length ?? COUNCIL_MODEL_IDS.length,
          startedAt: modelStartedAt,
          outcome,
        }));
      }

      let exchange: RedisMessage[] = [
        { role: 'user', content: data.message, attachments },
        ...(fullContent ? [{ role: 'assistant' as const, content: fullContent, modelId: selectedModel }] : []),
      ];
      let savedMessageIds: { userMessageId: string; assistantMessageId?: string } | undefined;
      try {
        await traceStep(traceId, 'db.persist', async () => {
          // A retry that produced nothing (failed, or stopped before the first
          // word) leaves the saved exchange untouched: there is nothing to put
          // in its place, so removing it would simply lose the answer.
          if (!isRetry || fullContent) {
            // The retried answer takes the place of the one it replaces.
            if (isRetry) await deleteLastExchange(conversationId);

            const saved = await addMessagesToConversation(
              conversationId,
              data.message,
              fullContent,
              selectedModel,
              attachments,
              skillTags(skills)
            );
            const userRow = saved.find((message) => message.role === 'user');
            const assistantRow = saved.find((message) => message.role === 'assistant');
            if (userRow) savedMessageIds = { userMessageId: userRow.id, assistantMessageId: assistantRow?.id };
            exchange = [
              {
                id: userRow?.id,
                role: 'user',
                content: data.message,
                attachments,
                createdAt: userRow?.createdAt?.toISOString(),
              },
              ...(fullContent
                ? [{
                    id: assistantRow?.id,
                    role: 'assistant' as const,
                    content: fullContent,
                    modelId: selectedModel,
                    createdAt: assistantRow?.createdAt?.toISOString(),
                  }]
                : []),
            ];

            const cacheHistory = [...prepared.rawHistory, ...exchange];
            if (isRetry) {
              await dropSnapshotIfBoundaryMissing(
                conversationId,
                cacheHistory.map((message) => message.id).filter((id): id is string => Boolean(id))
              );
            }
            if (cacheHistory.every((message) => !message.attachments?.length)) {
              await redisStore.set(conversationId, cacheHistory);
            } else {
              await redisStore.delete(conversationId);
            }
          }
          await markDocumentsUsed(userId, attachments);
        });
        if (savedMessageIds) send({ savedMessages: savedMessageIds });
      } catch (error) {
        captureError(error, { route: '/api/chat', model: selectedModel, council: isCouncilMode, stage: 'persist', userId });
        throw error;
      }
      if (fullContent) {
        await ingestConversationData(userId, conversationId, data.message, fullContent, selectedModel, traceId);
      }

      // Usually finished long before the answer; bounded by the title timeout.
      await titleTask;
      } catch (error) {
        // Anything that fails after the answer (saving, ingestion) fails the turn.
        requestStatus = 'error';
        requestError ??= error;
        throw error;
      } finally {
        recordRequestSpan({
          traceId,
          startedAt: requestStartedAt,
          status: requestStatus,
          model: selectedModel,
          council: isCouncilMode,
          userId,
          conversationId,
          question: data.message || undefined,
          answer: requestAnswer,
          error: requestError,
          attributes: {
            'chatterstack.thinking_level': thinkingLevel,
            'chatterstack.attachment_count': attachments.length,
            'chatterstack.rag_used': requestRagUsed,
            'chatterstack.new_conversation': isNewConversation,
            'chatterstack.context_compacted': Boolean(prepared.compaction),
            'chatterstack.context_tokens_before': prepared.compaction?.inputTokensBefore,
            'chatterstack.context_tokens_after': prepared.compaction?.inputTokensAfter,
          },
        });
      }
    };

    return createSSEStream(async (stream) => {
      try {
        await respond(stream);
      } finally {
        turn.end();
      }
    }, request.signal);
  } catch (error) {
    captureError(error, { route: '/api/chat', stage: 'request' });
    return finish(new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    ), error);
  }
}
