import type { Message } from "types";

const OPENROUTER_KEY = process.env.OPENROUTER_KEY!;

type Model = "openai/gpt-40" | "openai/gpt-5";


export const createCompletion= async (messages: Message[] , model: Model)=>{
    const question = 'How would you build the tallest building ever?';
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
        Authorization: `Bearer <OPENROUTER_API_KEY>`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: messages,
        stream: true,
    }),
    });

    const reader = response.body?.getReader();
    if (!reader) {
    throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append new chunk to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines from buffer
        while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;

        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0].delta.content;
            if (content) {
                console.log(content);
            }
            } catch (e) {
            // Ignore invalid JSON
            }
        }
        }
    }
    } finally {
    reader.cancel();
    }
}
