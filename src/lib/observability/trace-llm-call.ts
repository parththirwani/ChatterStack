import { estimateCostUsd, estimateTokens } from './cost';
import {
  enqueueLlmCallRecord,
  openObserveConfig,
  truncateContent,
  type LlmCallRecord,
  type LlmCallStatus,
  type OpenObserveConfig,
} from './openobserve';
import {
  contentAttributes,
  enqueueSpan,
  newSpanId,
  requestSpanId,
  traceContentEnabled,
  tracesEnabled,
  type TraceMessage,
} from './otlp-traces';

export const PROVIDER = 'openrouter';

export interface LlmTraceContext {
  /** One id per chat request, shared by every stage of a council run. */
  traceId: string;
  /** Stage/span name: 'completion', 'council-member-answer', 'chair-synthesis', 'embeddings', ... */
  span: string;
  model: string;
  userId?: string;
  conversationId?: string;
  provider?: string;
  thinkingLevel?: string;
  messageCount?: number;
  attachmentCount?: number;
  ragUsed?: boolean;
  /** The text sent to the model. Used to estimate tokens; logged only when enabled. */
  prompt?: string;
  /** Aborted when the user pressed Stop or disconnected. */
  signal?: AbortSignal;
  /** The messages sent, for the trace view (text only; files are counted). */
  messages?: TraceMessage[];
  /** True when this call belongs to a chat request: its span nests under that request's root span. */
  inRequest?: boolean;
  /** 'chat' for completions, 'embeddings' for embedding calls. */
  operation?: 'chat' | 'embeddings';
}

export interface LlmCallMetrics {
  firstToken(): void;
  usage(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined | null): void;
  finishReason(reason: string | undefined): void;
  completion(text: string): void;
}

const noopMetrics: LlmCallMetrics = {
  firstToken: () => {},
  usage: () => {},
  finishReason: () => {},
  completion: () => {},
};

const isAbort = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'AbortError' || error.name === 'APIUserAbortError' || /signal aborted/i.test(error.message));

function errorType(error: unknown): string {
  if (error instanceof Error) return error.name || error.constructor.name;
  return typeof error;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Only the provider's own line: never a prompt, an answer or a file.
  return truncateContent(message.replace(/\s+/g, ' ').trim()) ?? 'unknown error';
}

/** Drops keys whose value is undefined, so records stay small and tidy. */
function compact(record: LlmCallRecord): LlmCallRecord {
  const entry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) entry[key] = value;
  }
  return entry as unknown as LlmCallRecord;
}

/**
 * Times one model call, records it, and re-throws whatever happened unchanged.
 *
 * Without OpenObserve configured the callback simply runs with inert metrics,
 * so local development, tests and Docker pay nothing.
 */
export async function traceLlmCall<T>(
  context: LlmTraceContext,
  run: (metrics: LlmCallMetrics) => Promise<T>
): Promise<T> {
  const config = openObserveConfig();
  if (!config) return run(noopMetrics);

  const startedAt = Date.now();
  const metrics = {
    firstTokenAt: 0,
    usage: undefined as { prompt_tokens?: number; completion_tokens?: number } | undefined,
    finishReason: undefined as string | undefined,
    completion: '',
  };

  const collected: LlmCallMetrics = {
    firstToken: () => {
      if (!metrics.firstTokenAt) metrics.firstTokenAt = Date.now();
    },
    usage: (usage) => {
      if (usage) metrics.usage = usage;
    },
    finishReason: (reason) => {
      if (reason) metrics.finishReason = reason;
    },
    completion: (text) => {
      metrics.completion = text;
    },
  };

  let status: LlmCallStatus = 'ok';
  let failure: unknown;

  try {
    const result = await run(collected);
    // Stopping mid-stream resolves with what was written: that is a stop, not a failure.
    if (context.signal?.aborted) status = 'aborted';
    return result;
  } catch (error) {
    failure = error;
    status = isAbort(error) || context.signal?.aborted ? 'aborted' : 'error';
    throw error;
  } finally {
    recordCall(config, context, metrics, status, failure, startedAt);
  }
}

function recordCall(
  config: OpenObserveConfig,
  context: LlmTraceContext,
  metrics: { firstTokenAt: number; usage?: { prompt_tokens?: number; completion_tokens?: number }; finishReason?: string; completion: string },
  status: LlmCallStatus,
  failure: unknown,
  startedAt: number
): void {
  try {
    const inputTokens = metrics.usage?.prompt_tokens ?? (context.prompt !== undefined ? estimateTokens(context.prompt) : undefined);
    const outputTokens = metrics.usage?.completion_tokens ?? (metrics.completion ? estimateTokens(metrics.completion) : undefined);

    enqueueLlmCallRecord(compact({
      _timestamp: startedAt * 1000,
      timestamp: new Date(startedAt).toISOString(),
      trace_id: context.traceId,
      span: context.span,
      provider: context.provider ?? PROVIDER,
      model: context.model,
      user_id: context.userId,
      conversation_id: context.conversationId,
      thinking_level: context.thinkingLevel,
      status,
      stopped: status === 'aborted',
      duration_ms: Math.max(0, Date.now() - startedAt),
      time_to_first_token_ms: metrics.firstTokenAt ? Math.max(0, metrics.firstTokenAt - startedAt) : undefined,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated: metrics.usage === undefined,
      cost_usd: estimateCostUsd(context.model, inputTokens, outputTokens),
      finish_reason: metrics.finishReason,
      message_count: context.messageCount,
      attachment_count: context.attachmentCount,
      rag_used: context.ragUsed,
      error_type: failure !== undefined ? errorType(failure) : undefined,
      error_message: failure !== undefined ? errorMessage(failure) : undefined,
      prompt: config.logContent ? truncateContent(context.prompt) : undefined,
      completion: config.logContent ? truncateContent(metrics.completion) : undefined,
    }));
  } catch {
    // Observability must never break the call it describes.
  }

  if (tracesEnabled()) recordCallSpan(context, metrics, status, failure, startedAt);
}

function recordCallSpan(
  context: LlmTraceContext,
  metrics: { firstTokenAt: number; usage?: { prompt_tokens?: number; completion_tokens?: number }; finishReason?: string; completion: string },
  status: LlmCallStatus,
  failure: unknown,
  startedAt: number
): void {
  try {
    const inputTokens = metrics.usage?.prompt_tokens ?? (context.prompt !== undefined ? estimateTokens(context.prompt) : undefined);
    const outputTokens = metrics.usage?.completion_tokens ?? (metrics.completion ? estimateTokens(metrics.completion) : undefined);
    const operation = context.operation ?? 'chat';
    const input: TraceMessage[] = context.messages ?? (context.prompt !== undefined ? [{ role: 'user', content: context.prompt }] : []);

    enqueueSpan({
      traceId: context.traceId,
      spanId: newSpanId(),
      parentSpanId: context.inRequest ? requestSpanId(context.traceId) : undefined,
      name: `${context.span} ${context.model}`,
      kind: 3,
      startedAt,
      endedAt: Date.now(),
      status,
      errorMessage: failure !== undefined ? errorMessage(failure) : undefined,
      attributes: {
        'gen_ai.operation.name': operation,
        'gen_ai.provider.name': context.provider ?? PROVIDER,
        'gen_ai.system': context.provider ?? PROVIDER,
        'gen_ai.request.model': context.model,
        'gen_ai.response.model': context.model,
        'gen_ai.usage.input_tokens': inputTokens,
        'gen_ai.usage.output_tokens': outputTokens,
        'gen_ai.response.finish_reasons': metrics.finishReason ? [metrics.finishReason] : undefined,
        'gen_ai.conversation.id': context.conversationId,
        'user.id': context.userId,
        'error.type': failure !== undefined ? errorType(failure) : undefined,
        'chatterstack.span': context.span,
        'chatterstack.thinking_level': context.thinkingLevel,
        // OpenObserve prices spans from its own model table, which does not know
        // OpenRouter ids; send the cost from src/config/models.ts instead.
        'gen_ai.usage.cost': estimateCostUsd(context.model, inputTokens, outputTokens),
        'chatterstack.cost_usd': estimateCostUsd(context.model, inputTokens, outputTokens),
        'chatterstack.tokens_estimated': metrics.usage === undefined,
        'chatterstack.time_to_first_token_ms': metrics.firstTokenAt ? Math.max(0, metrics.firstTokenAt - startedAt) : undefined,
        'chatterstack.message_count': context.messageCount,
        'chatterstack.attachment_count': context.attachmentCount,
        'chatterstack.rag_used': context.ragUsed,
        'chatterstack.stopped': status === 'aborted',
        'chatterstack.answer_length': operation === 'chat' ? metrics.completion.length : undefined,
        ...(traceContentEnabled()
          ? contentAttributes(input, operation === 'chat' ? metrics.completion : undefined)
          : {}),
      },
    });
  } catch {
    // Tracing must never break the call it describes.
  }
}

/** Flat text of the messages sent to a model, for token estimates and opt-in logging. */
export function promptText(messages: Array<{ role: string; content: unknown }>): string {
  return messages
    .map((message) => {
      if (typeof message.content === 'string') return `${message.role}: ${message.content}`;
      if (Array.isArray(message.content)) {
        // Attachment parts are skipped entirely: only text is ever described.
        const text = message.content
          .filter((part): part is { type: string; text: string } =>
            typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text')
          .map((part) => part.text)
          .join('\n');
        const files = message.content.filter((part) =>
          typeof part === 'object' && part !== null && (part as { type?: string }).type !== 'text').length;
        return `${message.role}: ${text}${files ? ` [+${files} file part(s)]` : ''}`;
      }
      return `${message.role}:`;
    })
    .join('\n');
}
