// backend/openrouter.ts
import { Role } from "./types";

interface OpenRouterMessage {
  role: string;
  content: string;
}

export async function createCompletion(
  messages: { role: Role; content: string }[],
  model: string = "gpt-3.5-turbo",
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const openRouterMessages: OpenRouterMessage[] = messages.map(msg => ({
    role: msg.role === Role.User ? "user" : "assistant",
    content: msg.content
  }));

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.BACKEND_URL || "http://localhost:3000",
      "X-Title": "ChatterStack"
    },
    body: JSON.stringify({
      model: model,
      messages: openRouterMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4000,
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenRouter API error:", response.status, errorText);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error("No response body");
  }

  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        
        if (data === '[DONE]') {
          return fullContent;
        }
        
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          
          if (content) {
            fullContent += content;
            onChunk(content);
          }
        } catch (e) {
          // Ignore invalid JSON chunks
        }
      }
    }
  }

  return fullContent;
}