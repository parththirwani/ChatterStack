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
export function delta(fields: { content?: string; reasoning?: string }, finishReason?: string) {
  return { choices: [{ delta: fields, ...(finishReason ? { finish_reason: finishReason } : {}) }] };
}

/** One `tool_calls` entry as it arrives on the wire. */
export function toolCallDelta(entry: {
  index?: number;
  id?: string;
  name?: string;
  arguments?: string;
}) {
  return {
    choices: [{
      delta: {
        tool_calls: [{
          ...(entry.index === undefined ? {} : { index: entry.index }),
          ...(entry.id === undefined ? {} : { id: entry.id }),
          type: 'function',
          function: {
            ...(entry.name === undefined ? {} : { name: entry.name }),
            ...(entry.arguments === undefined ? {} : { arguments: entry.arguments }),
          },
        }],
      },
    }],
  };
}

/** Splits a JSON argument blob into per-token deltas for one tool call. */
export function toolCallArgumentChunks(index: number, chunks: string[]) {
  return chunks.map((part) => toolCallDelta({ index, arguments: part }));
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
