import { formatMessagesWithSystemContext } from '@/src/services/prompt/promptService';

export async function createCompletion(
  messages: Array<{ role: string; content: string }>,
  model: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const formattedMessages = formatMessagesWithSystemContext(messages, model);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'ChatterStack',
    },
    body: JSON.stringify({
      model: model,
      messages: formattedMessages,
      stream: true,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body');
  }

  let fullContent = '';
  let pending = '';

  const handleLine = (line: string): boolean => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    if (!data) return false;

    const parsed = JSON.parse(data);
    if (parsed.error) {
      throw new Error(parsed.error.message || 'OpenRouter stream error');
    }
    const content = parsed.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content) {
      fullContent += content;
      onChunk(content);
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (handleLine(line)) return fullContent;
    }
  }

  pending += decoder.decode();
  if (pending && handleLine(pending)) return fullContent;

  return fullContent;
}
