/** The SSE response keeps working (and stops upstream work) once the client goes away. */
import { describe, expect, it, vi } from 'vitest';
import { createSSEStream } from '@/src/lib/api/chat/sse-helper';
import { readEvents } from '../helpers/sse';

describe('createSSEStream', () => {
  it('streams events and ends with [DONE]', async () => {
    const response = createSSEStream(async ({ send }) => {
      send({ chunk: 'a' });
      send({ done: true });
    });
    expect(await readEvents(response)).toEqual([{ chunk: 'a' }, { done: true }, '[DONE]']);
  });

  it('turns a thrown handler error into an error event', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = createSSEStream(async () => {
      throw new Error('boom');
    });
    expect(await readEvents(response)).toEqual([{ error: 'boom' }, '[DONE]']);
  });

  it('aborts its signal when the client disconnects, and later sends are ignored', async () => {
    let finished = false;
    let signal!: AbortSignal;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const response = createSSEStream(async (stream) => {
      signal = stream.signal;
      stream.send({ chunk: 'first' });
      await gate;
      // Would throw "Invalid state" on a closed controller before the fix.
      stream.send({ chunk: 'after disconnect' });
      finished = true; // bookkeeping after the stream still runs
    });

    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal.aborted).toBe(true);

    release();
    await vi.waitFor(() => expect(finished).toBe(true));
  });

  it('aborts when the request is aborted (Stop)', async () => {
    const request = new AbortController();
    let signal!: AbortSignal;
    const response = createSSEStream(async (stream) => {
      signal = stream.signal;
      request.abort();
    }, request.signal);
    await readEvents(response);
    expect(signal.aborted).toBe(true);
  });
});
