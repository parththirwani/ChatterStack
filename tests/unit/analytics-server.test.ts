/**
 * Server analytics helper: inert without POSTHOG_KEY, correct payload shape
 * with it, and never able to break the request that calls it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constructed: Array<{ key: string; options: Record<string, unknown> }> = [];
const capture = vi.fn();
const flush = vi.fn(async () => {});
const afterCalls: Array<() => Promise<void>> = [];

const { afterMock } = vi.hoisted(() => ({ afterMock: vi.fn() }));

vi.mock('posthog-node', () => ({
  PostHog: class FakePostHog {
    constructor(key: string, options: Record<string, unknown>) {
      constructed.push({ key, options });
    }
    on() {}
    capture(props: unknown) {
      capture(props);
    }
    flush() {
      return flush();
    }
  },
}));

vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => afterMock(callback),
}));

const { captureServerEvent, getPostHogClient, flushServerEvents } = await import(
  '@/src/lib/analytics/posthog-server'
);
const { chatMessageSentProps } = await import('@/src/lib/analytics/events');

type CacheHolder = { __chatterstackPostHog?: unknown };
const cacheHolder = globalThis as unknown as CacheHolder;

const USER = '11111111-2222-3333-4444-555555555555';
const SENT_PROPS = {
  model_id: 'openai/gpt-6.1-sol',
  council: false,
  thinking_level: 'medium' as const,
  attachment_count: 0,
  message_length_bucket: '1-99' as const,
};

beforeEach(() => {
  constructed.length = 0;
  capture.mockClear();
  flush.mockClear();
  afterCalls.length = 0;
  afterMock.mockImplementation((callback: () => Promise<void>) => {
    afterCalls.push(callback);
  });
  delete cacheHolder.__chatterstackPostHog;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getPostHogClient', () => {
  it('is null and stays untouched with no key', () => {
    expect(getPostHogClient()).toBeNull();
    expect(constructed).toHaveLength(0);
  });

  it('builds one lazily and reuses it, defaulting the host', () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    const first = getPostHogClient();
    const second = getPostHogClient();
    expect(constructed).toHaveLength(1);
    expect(first).toBe(second);
    expect(constructed[0].key).toBe('phc_test');
    expect(constructed[0].options.host).toBe('https://us.i.posthog.com');
  });

  it('honours POSTHOG_HOST', () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    vi.stubEnv('POSTHOG_HOST', 'https://eu.i.posthog.com');
    getPostHogClient();
    expect(constructed[0].options.host).toBe('https://eu.i.posthog.com');
  });
});

describe('captureServerEvent', () => {
  it('does nothing without a key', () => {
    captureServerEvent(USER, 'chat_message_sent', SENT_PROPS);
    expect(capture).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  it('does nothing without a user id', () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    captureServerEvent(undefined, 'chat_message_sent', SENT_PROPS);
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures with the user id as distinct id', () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    captureServerEvent(USER, 'conversation_pinned', { pinned: true });
    expect(capture).toHaveBeenCalledWith({
      distinctId: USER,
      event: 'conversation_pinned',
      properties: { pinned: true },
    });
  });

  it('schedules the flush after the response instead of blocking it', async () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    captureServerEvent(USER, 'document_uploaded', { mime_type: 'application/pdf', size_bucket: '1mb-5mb' });
    expect(flush).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('still flushes in the background outside a request scope', async () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    afterMock.mockImplementationOnce(() => {
      throw new Error('"after" was called outside a request scope');
    });
    expect(() => captureServerEvent(USER, 'document_deleted', {})).not.toThrow();
    await flushServerEvents();
    expect(flush).toHaveBeenCalled();
  });

  it('never puts message content into the event payload', () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    const secret = 'why does my cat vomit on the rug';
    captureServerEvent(
      USER,
      'chat_message_sent',
      chatMessageSentProps({
        modelId: 'anthropic/claude-sonnet-5.5',
        council: false,
        thinkingLevel: 'medium',
        attachmentCount: 1,
        messageLength: secret.length,
      })
    );

    const payload = JSON.stringify(capture.mock.calls[0][0]);
    expect(payload).not.toContain(secret);
    expect(payload).not.toContain('secret');
    expect(capture.mock.calls[0][0].properties).toEqual({
      model_id: 'anthropic/claude-sonnet-5.5',
      council: false,
      thinking_level: 'medium',
      attachment_count: 1,
      message_length_bucket: '1-99',
    });
  });
});
