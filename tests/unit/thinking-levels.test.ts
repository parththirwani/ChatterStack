import { describe, expect, it } from 'vitest';
import {
  CHAT_MODELS,
  THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  THINKING_LEVEL_HINTS,
  DEFAULT_THINKING_LEVEL,
  TITLE_MODEL,
  closestThinkingLevel,
  effectiveThinkingLevel,
  getThinkingLevels,
  modelSupportsReasoning,
  type ThinkingLevel,
} from '@/src/config/models';

// `reasoning.supported_efforts` from https://openrouter.ai/api/v1/models,
// captured 2026-10-26 ('none' is shown to users as 'off').
const OPENROUTER_SUPPORTED_EFFORTS: Record<string, string[]> = {
  'deepseek/deepseek-v4.1-flash-1017': ['max', 'high', 'low', 'none'],
  'google/gemini-4-argon': ['high', 'medium', 'low'],
  'openai/gpt-6.1-sol': ['max', 'xhigh', 'high', 'medium', 'low'],
  'anthropic/claude-sonnet-5.5': ['max', 'xhigh', 'high', 'medium', 'low'],
};

const toLevel = (effort: string) => (effort === 'none' ? 'off' : effort) as ThinkingLevel;

describe('thinking levels', () => {
  it('offers levels above High, ordered from least to most reasoning', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(THINKING_LEVEL_LABELS.xhigh).toBe('Extra high');
    expect(THINKING_LEVEL_LABELS.max).toBe('Max');
  });

  it('has a label and a one-line hint for every level', () => {
    for (const level of THINKING_LEVELS) {
      expect(THINKING_LEVEL_LABELS[level]).toBeTruthy();
      expect(THINKING_LEVEL_HINTS[level]).toMatch(/\.$/);
    }
  });

  it('defaults to Medium', () => {
    expect(DEFAULT_THINKING_LEVEL).toBe('medium');
  });

  it.each(Object.entries(OPENROUTER_SUPPORTED_EFFORTS))(
    'matches the OpenRouter catalog for %s',
    (modelId, efforts) => {
      const expected = THINKING_LEVELS.filter((level) => efforts.map(toLevel).includes(level));
      expect(getThinkingLevels(modelId)).toEqual(expected);
    }
  );

  it('covers every chat model with a valid, non-empty level set', () => {
    for (const model of CHAT_MODELS) {
      expect(model.thinkingLevels.length).toBeGreaterThan(0);
      for (const level of model.thinkingLevels) expect(THINKING_LEVELS).toContain(level);
    }
  });

  it('only lets models that support "none" turn thinking off', () => {
    expect(getThinkingLevels('deepseek/deepseek-v4.1-flash-1017')).toContain('off');
    expect(getThinkingLevels('google/gemini-4-argon')).not.toContain('off');
    expect(getThinkingLevels('openai/gpt-6.1-sol')).not.toContain('off');
    expect(getThinkingLevels('anthropic/claude-sonnet-5.5')).not.toContain('off');
  });

  it('treats unknown models as not reasoning', () => {
    expect(getThinkingLevels('someone/unknown')).toEqual(['off']);
    expect(modelSupportsReasoning('someone/unknown')).toBe(false);
    expect(modelSupportsReasoning('google/gemini-4-argon')).toBe(true);
  });
});

describe('closestThinkingLevel', () => {
  it('keeps a supported level', () => {
    expect(closestThinkingLevel(['low', 'medium', 'high'], 'medium')).toBe('medium');
  });

  it('picks the nearest level, rounding down on a tie', () => {
    // medium sits between low and high: round down (faster, cheaper)
    expect(closestThinkingLevel(['off', 'low', 'high', 'max'], 'medium')).toBe('low');
    expect(closestThinkingLevel(['off', 'low', 'high', 'max'], 'xhigh')).toBe('high');
  });

  it('clamps to the ends of the supported range', () => {
    expect(closestThinkingLevel(['low', 'medium', 'high'], 'max')).toBe('high');
    expect(closestThinkingLevel(['low', 'medium', 'high'], 'off')).toBe('low');
  });
});

describe('effectiveThinkingLevel', () => {
  it('never asks a model for a level it does not support', () => {
    for (const model of CHAT_MODELS) {
      for (const level of THINKING_LEVELS) {
        expect(getThinkingLevels(model.id)).toContain(effectiveThinkingLevel(model.id, level));
      }
    }
  });

  it('maps Max on Gemini to High and Off to Low', () => {
    expect(effectiveThinkingLevel('google/gemini-4-argon', 'max')).toBe('high');
    expect(effectiveThinkingLevel('google/gemini-4-argon', 'off')).toBe('low');
  });

  it('passes Extra high and Max through for GPT and Claude', () => {
    expect(effectiveThinkingLevel('openai/gpt-6.1-sol', 'xhigh')).toBe('xhigh');
    expect(effectiveThinkingLevel('anthropic/claude-sonnet-5.5', 'max')).toBe('max');
  });
});

describe('title model', () => {
  it('uses GPT-5.6 Luna for chat titles', () => {
    expect(TITLE_MODEL).toBe('openai/gpt-5.6-luna');
  });
});
