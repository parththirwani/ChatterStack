import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '@/src/services/api';
import { sseResponse } from '../helpers/sse';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = { message: 'hi', selectedModel: 'openai/gpt-6.1-sol' };

describe('ApiService.sendMessage stream parsing', () => {
  it('delivers every event in order even when lines are split across network reads', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          { status: 'starting' },
          { conversationCreated: '0e7ba32e-05b0-477d-8e30-2bf0a849649e' },
          { reasoning: 'Let me think — ü' },
          { title: 'TCP Congestion Control' },
          { chunk: 'Hello ' },
          { chunk: 'world' },
          { status: 'progress', stage: 'stage1', model: 'openai/gpt-6.1-sol', progress: 100 },
          { councilAnswer: { model: 'openai/gpt-6.1-sol', response: 'A' } },
          { councilRankings: [{ model: 'openai/gpt-6.1-sol', averageRank: 1 }] },
          { done: true },
          '[DONE]',
        ],
        5
      )
    );

    const log: string[] = [];
    await ApiService.sendMessage(request, {
      onConversationCreated: (id) => log.push(`created:${id}`),
      onReasoning: (text) => log.push(`reasoning:${text}`),
      onTitle: (title) => log.push(`title:${title}`),
      onChunk: (chunk) => log.push(`chunk:${chunk}`),
      onProgress: (p) => log.push(`progress:${p.stage}:${p.progress}`),
      onCouncilAnswer: (a) => log.push(`answer:${a.model}`),
      onCouncilRankings: (r) => log.push(`rankings:${r.length}`),
      onDone: () => log.push('done'),
    });

    expect(log).toEqual([
      'created:0e7ba32e-05b0-477d-8e30-2bf0a849649e',
      'reasoning:Let me think — ü',
      'title:TCP Congestion Control',
      'chunk:Hello ',
      'chunk:world',
      'progress:stage1:100',
      'answer:openai/gpt-6.1-sol',
      'rankings:1',
      'done',
      'done',
    ]);
  });

  it('hands over the completion analytics before the stream ends', async () => {
    const analytics = {
      durationMs: 4200,
      inputTokens: 120,
      outputTokens: 340,
      totalTokens: 460,
      timings: [{ model: 'openai/gpt-6.1-sol', stage: 'stage1', durationMs: 4100 }],
    };
    fetchMock.mockResolvedValue(sseResponse([{ chunk: 'Answer' }, { analytics }, { done: true }, '[DONE]']));

    const log: string[] = [];
    await ApiService.sendMessage(request, {
      onChunk: () => log.push('chunk'),
      onAnalytics: (value) => log.push('analytics:' + value.totalTokens + ':' + value.timings?.[0]?.model),
      onDone: () => log.push('done'),
    });

    // Both the done event and the closing [DONE] end the stream.
    expect(log).toEqual(['chunk', 'analytics:460:openai/gpt-6.1-sol', 'done', 'done']);
  });

  it('surfaces a server error instead of silently ignoring it', async () => {
    fetchMock.mockResolvedValue(sseResponse([{ chunk: 'partial' }, { error: 'Rate limited' }, '[DONE]']));
    await expect(ApiService.sendMessage(request, {})).rejects.toThrow('Rate limited');
  });

  it('rejects on a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(ApiService.sendMessage(request, {})).rejects.toThrow(/429/);
  });

  it('sends the thinking level, council settings and new-chat flag to the server', async () => {
    fetchMock.mockResolvedValue(sseResponse(['[DONE]']));
    const body = {
      ...request,
      selectedModel: 'council',
      conversationId: '0e7ba32e-05b0-477d-8e30-2bf0a849649e',
      newConversation: true,
      thinkingLevel: 'max' as const,
      council: { members: ['openai/gpt-6.1-sol', 'google/gemini-4-argon'], chair: 'google/gemini-4-argon' },
    };
    await ApiService.sendMessage(body, {});
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
  });

  it('passes the abort signal through so Stop can cancel', async () => {
    fetchMock.mockResolvedValue(sseResponse(['[DONE]']));
    const controller = new AbortController();
    await ApiService.sendMessage(request, {}, controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('ApiService.updateConversation', () => {
  it('PATCHes a rename', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ conversation: { id: 'c1', title: 'New name', pinnedAt: null, updatedAt: 'x' } }), { status: 200 })
    );
    const result = await ApiService.updateConversation('c1', { title: 'New name' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/conversations/c1');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ title: 'New name' }) });
    expect(result.title).toBe('New name');
  });

  it('PATCHes a pin and throws on failure', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(ApiService.updateConversation('c1', { pinned: true })).rejects.toThrow(/404/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ pinned: true });
  });
});
