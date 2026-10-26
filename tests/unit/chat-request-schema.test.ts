import { describe, expect, it } from 'vitest';
import { ChatRequestSchema } from '@/src/types/chat.types';

const base = { message: 'Hello', selectedModel: 'openai/gpt-6.1-sol' };
const uuid = '0e7ba32e-05b0-477d-8e30-2bf0a849649e';

describe('ChatRequestSchema', () => {
  it.each(['off', 'low', 'medium', 'high', 'xhigh', 'max'])('accepts thinking level %s', (thinkingLevel) => {
    expect(ChatRequestSchema.safeParse({ ...base, thinkingLevel }).success).toBe(true);
  });

  it('rejects an unknown thinking level', () => {
    expect(ChatRequestSchema.safeParse({ ...base, thinkingLevel: 'ultra' }).success).toBe(false);
  });

  it('accepts council mode with 2 to 4 distinct members', () => {
    const council = { members: ['openai/gpt-6.1-sol', 'google/gemini-4-argon'], chair: 'google/gemini-4-argon' };
    expect(ChatRequestSchema.safeParse({ ...base, selectedModel: 'council', council }).success).toBe(true);
  });

  it('rejects a council with fewer than 2 members', () => {
    const council = { members: ['openai/gpt-6.1-sol'], chair: 'openai/gpt-6.1-sol' };
    expect(ChatRequestSchema.safeParse({ ...base, selectedModel: 'council', council }).success).toBe(false);
  });

  it('rejects a council with more than 4 members', () => {
    const council = {
      members: [
        'openai/gpt-6.1-sol',
        'google/gemini-4-argon',
        'anthropic/claude-sonnet-5.5',
        'deepseek/deepseek-v4.1-flash-1017',
        'openai/gpt-6.1-sol',
      ],
      chair: 'openai/gpt-6.1-sol',
    };
    expect(ChatRequestSchema.safeParse({ ...base, selectedModel: 'council', council }).success).toBe(false);
  });

  it('rejects duplicate council members and unknown models', () => {
    const duplicate = { members: ['openai/gpt-6.1-sol', 'openai/gpt-6.1-sol'], chair: 'openai/gpt-6.1-sol' };
    const unknown = { members: ['openai/gpt-6.1-sol', 'x/unknown'], chair: 'openai/gpt-6.1-sol' };
    expect(ChatRequestSchema.safeParse({ ...base, selectedModel: 'council', council: duplicate }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...base, selectedModel: 'council', council: unknown }).success).toBe(false);
  });

  it('accepts a client-generated id for a new conversation', () => {
    const parsed = ChatRequestSchema.safeParse({ ...base, conversationId: uuid, newConversation: true });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.newConversation).toBe(true);
  });

  it('rejects a non-uuid conversation id', () => {
    expect(ChatRequestSchema.safeParse({ ...base, conversationId: 'temp_123' }).success).toBe(false);
  });

  it('rejects unsupported models', () => {
    expect(ChatRequestSchema.safeParse({ ...base, selectedModel: 'x/unknown' }).success).toBe(false);
  });
});
