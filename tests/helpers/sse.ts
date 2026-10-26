/**
 * Build a streaming Response whose body arrives in small fragments that cut
 * through SSE lines and multi-byte characters, like a real network would.
 */
export function sseResponse(events: Array<object | string>, fragmentSize = 7): Response {
  const text = events
    .map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`)
    .join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += fragmentSize) {
        controller.enqueue(bytes.slice(i, i + fragmentSize));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** OpenRouter-style chat completion chunk. */
export function delta(fields: { content?: string; reasoning?: string }) {
  return { choices: [{ delta: fields }] };
}

/** Read a server SSE Response into the list of JSON payloads it sent. */
export async function readEvents(response: Response): Promise<Array<Record<string, unknown> | '[DONE]'>> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => {
      const data = block.slice(6);
      return data === '[DONE]' ? '[DONE]' : JSON.parse(data);
    });
}
