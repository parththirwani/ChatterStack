import { describe, expect, it } from 'vitest';
import {
  AnalyticsEvents,
  chatMessageSentProps,
  chatResponseCompletedProps,
  councilRunCompletedProps,
  messageLengthBucket,
  sizeBucket,
} from '@/src/lib/analytics/events';

describe('event names', () => {
  it('are snake_case and stable', () => {
    expect(Object.values(AnalyticsEvents)).toEqual([
      'sign_in_started',
      'chat_message_sent',
      'chat_response_completed',
      'council_run_completed',
      'conversation_created',
      'conversation_pinned',
      'conversation_deleted',
      'document_uploaded',
      'document_favorited',
      'document_deleted',
      'model_changed',
      'rate_limit_hit',
    ]);
    for (const name of Object.values(AnalyticsEvents)) {
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('messageLengthBucket', () => {
  it.each([
    [0, '0'],
    [-5, '0'],
    [1, '1-99'],
    [99, '1-99'],
    [100, '100-499'],
    [499, '100-499'],
    [500, '500-1999'],
    [1999, '500-1999'],
    [2000, '2000-7999'],
    [7999, '2000-7999'],
    [8000, '8000+'],
    [500000, '8000+'],
  ])('buckets %i characters as %s', (length, bucket) => {
    expect(messageLengthBucket(length)).toBe(bucket);
  });
});

describe('sizeBucket', () => {
  const kb = 1024;
  it.each([
    [0, '<100kb'],
    [12 * kb, '<100kb'],
    [100 * kb, '100kb-500kb'],
    [500 * kb, '500kb-1mb'],
    [1024 * kb, '1mb-5mb'],
    [5 * 1024 * kb, '5mb+'],
  ])('buckets %i bytes as %s', (bytes, bucket) => {
    expect(sizeBucket(bytes)).toBe(bucket);
  });
});

describe('property builders', () => {
  it('describes a sent message without any content', () => {
    expect(
      chatMessageSentProps({
        modelId: 'openai/gpt-6.1-sol',
        council: false,
        thinkingLevel: 'high',
        attachmentCount: 2,
        messageLength: 250,
      })
    ).toEqual({
      model_id: 'openai/gpt-6.1-sol',
      council: false,
      thinking_level: 'high',
      attachment_count: 2,
      message_length_bucket: '100-499',
    });
  });

  it('reports the response duration and outcome', () => {
    const props = chatResponseCompletedProps({
      modelId: 'council',
      council: true,
      startedAt: Date.now() - 1200,
      outcome: 'success',
    });
    expect(props.model_id).toBe('council');
    expect(props.council).toBe(true);
    expect(props.outcome).toBe('success');
    expect(props.duration_ms).toBeGreaterThanOrEqual(1100);
  });

  it('reports a council run', () => {
    const props = councilRunCompletedProps({ members: 4, startedAt: Date.now() - 50, outcome: 'stopped' });
    expect(props.members).toBe(4);
    expect(props.outcome).toBe('stopped');
  });

  it('never carries a free-text value', () => {
    const secret = 'the user wrote a private question about their mortgage';
    const props = chatMessageSentProps({
      modelId: 'council',
      council: true,
      thinkingLevel: 'low',
      attachmentCount: 1,
      messageLength: secret.length,
    });
    expect(JSON.stringify(props)).not.toContain(secret);
  });
});
