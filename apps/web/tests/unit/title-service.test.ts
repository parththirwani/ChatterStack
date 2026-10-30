import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateMany = vi.fn();
vi.mock('@/src/lib/prisma', () => ({ prisma: { conversation: { updateMany: (...args: unknown[]) => updateMany(...args) } } }));

const { generateConversationTitle, saveGeneratedTitle } = await import('@/src/services/title/titleService');

const fetchMock = vi.fn();
const completion = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  updateMany.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateConversationTitle', () => {
  it('asks GPT-5.6 Luna for a title, without reasoning', async () => {
    fetchMock.mockResolvedValue(completion('TCP Congestion Control Explained'));
    const title = await generateConversationTitle({ userMessage: 'Explain how TCP congestion control works in detail' });

    expect(title).toBe('TCP Congestion Control Explained');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('openai/gpt-5.6-luna');
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.messages.at(-1).content).toContain('Explain how TCP congestion control works');
  });

  it('uses the model even for short messages instead of copying them', async () => {
    fetchMock.mockResolvedValue(completion('Greeting'));
    expect(await generateConversationTitle({ userMessage: 'hi there' })).toBe('Greeting');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cleans quotes and trailing punctuation', async () => {
    fetchMock.mockResolvedValue(completion('"planning a trip to japan."'));
    expect(await generateConversationTitle({ userMessage: 'Help me plan a trip to Japan next spring' })).toBe('Planning a trip to japan');
  });

  it('falls back to the start of the message if the model fails', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    const message = 'x'.repeat(80);
    expect(await generateConversationTitle({ userMessage: message })).toBe(`${'x'.repeat(50)}...`);
  });

  it('is bounded by a timeout', async () => {
    fetchMock.mockResolvedValue(completion('Title'));
    await generateConversationTitle({ userMessage: 'Some question about databases' });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns "New Chat" for an empty message without calling the model', async () => {
    expect(await generateConversationTitle({ userMessage: '   ' })).toBe('New Chat');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('saveGeneratedTitle', () => {
  it('only writes when the chat has no title yet, so a rename is never overwritten', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await saveGeneratedTitle('c1', 'Generated')).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'c1', title: null }, data: { title: 'Generated' } });

    updateMany.mockResolvedValue({ count: 0 });
    expect(await saveGeneratedTitle('c1', 'Generated')).toBe(false);
  });
});
