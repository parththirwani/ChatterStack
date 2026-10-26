import { SSEData } from "@/src/types/chat.types";

export interface SSEStream {
  /** Sends an event; does nothing once the client has gone away. */
  send: (data: SSEData) => void;
  /** Aborts when the client stops the response or disconnects. */
  signal: AbortSignal;
}

/**
 * Runs `onStream` as a server-sent event response. Once the client stops
 * or disconnects, `signal` aborts (so upstream model calls can be cancelled)
 * and further sends are dropped instead of throwing, so the handler still
 * finishes its bookkeeping (saving messages, recording tokens).
 */
export function createSSEStream(
  onStream: (stream: SSEStream) => Promise<void>,
  requestSignal?: AbortSignal
) {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  requestSignal?.addEventListener('abort', () => abort.abort(), { once: true });
  let open = true;

  const stream = new ReadableStream({
    async start(controller) {
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
          abort.abort();
        }
      };
      const send = (data: SSEData) => write(`data: ${JSON.stringify(data)}\n\n`);

      try {
        await onStream({ send, signal: abort.signal });
      } catch (error) {
        console.error('[SSE] Stream handler failed:', error);
        send({ error: error instanceof Error ? error.message : 'Unknown error' });
      } finally {
        write('data: [DONE]\n\n');
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
