/**
 * Title Generation Service
 * Generates concise, descriptive titles for conversations based on the first user message
 */
import { TITLE_MODEL } from '@/src/config/models';
import { captureError } from '@/src/lib/observability/capture';
import { traceLlmCall, type LlmCallMetrics } from '@/src/lib/observability/trace-llm-call';

interface TitleGenerationParams {
  userMessage: string;
  /** Shared trace id of the chat request; the call is recorded when present. */
  trace?: { traceId: string; userId?: string; conversationId?: string };
}

const TITLE_TIMEOUT_MS = 8000;

/**
 * Generate a title using OpenRouter API
 */
async function generateTitleWithAI(userMessage: string, trace?: TitleGenerationParams['trace']): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    return generateFallbackTitle(userMessage);
  }

  try {
    return await traceLlmCall(
      {
        traceId: trace?.traceId ?? 'title-generation',
        span: 'title-generation',
        model: TITLE_MODEL,
        userId: trace?.userId,
        conversationId: trace?.conversationId,
        messageCount: 2,
        prompt: userMessage,
      },
      (metrics) => requestTitle(userMessage, metrics)
    );
  } catch (error) {
    // The fallback title keeps the UI fine; the failure is still worth reporting.
    captureError(error, { route: 'title', model: TITLE_MODEL, stage: 'title-generation' });
    return generateFallbackTitle(userMessage);
  }
}

async function requestTitle(userMessage: string, metrics: LlmCallMetrics): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'ChatterStack',
    },
    signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    body: JSON.stringify({
      model: TITLE_MODEL,
      // A title doesn't need reasoning; skipping it keeps this fast and cheap.
      reasoning: { effort: 'none' },
      messages: [
        {
          role: 'system',
          content: 'You are a title generator. Generate a concise, descriptive title (3-7 words) for a conversation based on the user\'s first message. Return ONLY the title, nothing else. Do not use quotes or punctuation at the end.',
        },
        {
          role: 'user',
          content: `Generate a title for this message: "${userMessage.slice(0, 2000)}"`,
        },
      ],
      temperature: 0.3,
      max_tokens: 30,
    }),
  });

  if (!response.ok) {
    throw new Error(`Title generation failed: ${response.status}`);
  }

  const data = await response.json();
  metrics.usage(data.usage);
  metrics.finishReason(data.choices?.[0]?.finish_reason);
  const title = data.choices?.[0]?.message?.content?.trim();
  metrics.completion(title ?? '');

  if (title && title.length > 0) {
    // Clean up the title
    return cleanTitle(title);
  }

  return generateFallbackTitle(userMessage);
}

/**
 * Clean and format the generated title
 */
function cleanTitle(title: string): string {
  // Remove quotes if present
  let cleaned = title.replace(/^["']|["']$/g, '');

  // Remove trailing punctuation
  cleaned = cleaned.replace(/[.!?]+$/, '');

  // Limit length
  if (cleaned.length > 60) {
    cleaned = cleaned.substring(0, 57) + '...';
  }

  // Capitalize first letter
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  return cleaned;
}

/**
 * Generate a fallback title from the user message
 */
function generateFallbackTitle(userMessage: string): string {
  // Take first 50 characters and add ellipsis if needed
  const title = userMessage.trim().substring(0, 50);
  return title.length < userMessage.trim().length ? `${title}...` : title;
}

/**
 * Main title generation function
 */
export async function generateConversationTitle(
  params: TitleGenerationParams
): Promise<string> {
  const { userMessage } = params;

  // Validate input
  if (!userMessage || userMessage.trim().length === 0) {
    return 'New Chat';
  }

  // Generate title with AI
  return generateTitleWithAI(userMessage, params.trace);
}

/**
 * Save a generated title unless the conversation already has one, so a
 * rename the user made while the title was generating is never overwritten.
 * Returns true when the title was saved.
 */
export async function saveGeneratedTitle(
  conversationId: string,
  title: string
): Promise<boolean> {
  const { prisma } = await import('@/src/lib/prisma');
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, title: null },
    data: { title },
  });
  return result.count > 0;
}
