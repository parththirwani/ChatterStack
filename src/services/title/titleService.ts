/**
 * Title Generation Service
 * Generates concise, descriptive titles for conversations based on the first user message
 */

interface TitleGenerationParams {
  userMessage: string;
  modelId?: string;
}

/**
 * Generate a title using OpenRouter API
 */
async function generateTitleWithAI(userMessage: string): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    return generateFallbackTitle(userMessage);
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'ChatterStack',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat-v3.1', // Fast and cheap model for title generation
        messages: [
          {
            role: 'system',
            content: 'You are a title generator. Generate a concise, descriptive title (3-7 words) for a conversation based on the user\'s first message. Return ONLY the title, nothing else. Do not use quotes or punctuation at the end.',
          },
          {
            role: 'user',
            content: `Generate a title for this message: "${userMessage}"`,
          },
        ],
        temperature: 0.7,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      throw new Error(`Title generation failed: ${response.status}`);
    }

    const data = await response.json();
    const title = data.choices?.[0]?.message?.content?.trim();

    if (title && title.length > 0) {
      // Clean up the title
      return cleanTitle(title);
    }

    return generateFallbackTitle(userMessage);
  } catch (error) {
    console.error('AI title generation failed:', error);
    return generateFallbackTitle(userMessage);
  }
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

  // If message is very short, just use it as the title
  if (userMessage.trim().length <= 40) {
    return cleanTitle(userMessage.trim());
  }

  // Generate title with AI
  return generateTitleWithAI(userMessage);
}

/**
 * Update conversation title in database
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<void> {
  try {
    const { prisma } = await import('@/src/lib/prisma');
    
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { title },
    });

    console.log(`✓ Updated title for conversation ${conversationId}: "${title}"`);
  } catch (error) {
    console.error('Failed to update conversation title:', error);
    throw error;
  }
}