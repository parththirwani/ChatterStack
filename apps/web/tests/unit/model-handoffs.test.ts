import { describe, expect, it } from 'vitest';
import { modelHandoffs } from '@/src/components/chat/interface/model-handoffs';
import type { Message } from '@/src/types/chat.types';

const user = (content: string): Message => ({ role: 'user', content });
const answer = (modelId?: string): Message => ({ role: 'assistant', content: 'Answer', modelId });

describe('modelHandoffs', () => {
  it('marks the first question answered by each new model', () => {
    const handoffs = modelHandoffs([
      user('One'), answer('openai/gpt-6.1-sol'),
      user('Two'), answer('anthropic/claude-sonnet-5.5'),
      user('Three'), answer('anthropic/claude-sonnet-5.5'),
      user('Four'), answer('openai/gpt-6.1-sol'),
    ]);
    expect([...handoffs.entries()]).toEqual([
      [2, { from: 'openai/gpt-6.1-sol', to: 'anthropic/claude-sonnet-5.5' }],
      [6, { from: 'anthropic/claude-sonnet-5.5', to: 'openai/gpt-6.1-sol' }],
    ]);
  });

  it('waits for an answer and skips unknown legacy models', () => {
    expect(modelHandoffs([user('One'), answer('openai/gpt-6.1-sol'), user('Two')]).size).toBe(0);
    expect(modelHandoffs([user('One'), answer(), user('Two'), answer('anthropic/claude-sonnet-5.5')]).size).toBe(0);
  });

  it('treats council variants as one mode', () => {
    const handoffs = modelHandoffs([
      user('One'), answer('openai/gpt-6.1-sol'),
      user('Two'), answer('council:members-a'),
      user('Three'), answer('council:members-b'),
    ]);
    expect([...handoffs.entries()]).toEqual([[2, { from: 'openai/gpt-6.1-sol', to: 'council' }]]);
  });
});
