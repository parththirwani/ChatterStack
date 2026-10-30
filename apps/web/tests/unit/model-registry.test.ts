import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAT_MODELS,
  COUNCIL_CHAIR_MODEL,
  COUNCIL_MODEL_IDS,
  DEFAULT_MODEL_ID,
  THINKING_LEVELS,
} from '@/src/config/models';

describe('chat model registry', () => {
  it('dates every model with a real release day, not in the future', () => {
    for (const model of CHAT_MODELS) {
      expect(model.released, model.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const day = new Date(`${model.released}T00:00:00Z`);
      expect(day.toISOString().slice(0, 10), model.id).toBe(model.released);
      expect(day.getTime(), model.id).toBeLessThanOrEqual(Date.now());
    }
  });

  it('has no duplicate ids', () => {
    const ids = CHAT_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the models the app launched with', () => {
    const ids = new Set<string>(CHAT_MODELS.map((model) => model.id));
    for (const id of COUNCIL_MODEL_IDS) expect(ids.has(id)).toBe(true);
    expect(ids.has(DEFAULT_MODEL_ID)).toBe(true);
    expect(ids.has('openai/gpt-6.1-sol')).toBe(true);
    expect(ids.has('google/gemini-4-argon')).toBe(true);
    expect(ids.has('anthropic/claude-sonnet-5.5')).toBe(true);
    expect(ids.has('deepseek/deepseek-v4.1-flash-1017')).toBe(true);
  });

  it('mirrors t3.chat across vendors', () => {
    const ids = new Set<string>(CHAT_MODELS.map((model) => model.id));
    for (const id of [
      'anthropic/claude-opus-5.5',
      'google/gemini-3.8-flash',
      'openai/gpt-6-astra',
      'deepseek/deepseek-v4-pro',
      'moonshotai/kimi-k3.1-pro',
      'z-ai/glm-5.3',
      'minimax/minimax-m3',
      'qwen/qwen3.8-27b',
      'x-ai/grok-4.7',
      'xiaomi/mimo-v2.5',
      'meta/muse-wonder',
      'meta-llama/llama-4-scout',
      'openai/gpt-oss-120b',
      'google/gemma-4-26b-a4b-it',
    ]) {
      expect(ids.has(id), `${id} is missing from the registry`).toBe(true);
    }
  });

  it('has complete metadata for every model', () => {
    for (const model of CHAT_MODELS) {
      expect(model.id).toMatch(/^[a-z0-9-]+\/[a-z0-9.:-]+$/);
      expect(model.name.trim()).not.toBe('');
      expect(model.description.trim()).not.toBe('');
      expect(model.company.trim()).not.toBe('');
      expect(model.contextLength).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
      expect(model.thinkingLevels.length).toBeGreaterThan(0);
      for (const level of model.thinkingLevels) expect(THINKING_LEVELS).toContain(level);
      expect(Number.isFinite(model.pricing.prompt)).toBe(true);
      expect(Number.isFinite(model.pricing.completion)).toBe(true);
      expect(model.pricing.prompt).toBeGreaterThanOrEqual(0);
      expect(model.pricing.completion).toBeGreaterThanOrEqual(0);
    }
  });

  it('has an icon file for every model logo', () => {
    for (const model of CHAT_MODELS) {
      expect(model.logo.startsWith('/'), `${model.id} logo must be a public path`).toBe(true);
      expect(
        fs.existsSync(path.join(process.cwd(), 'public', model.logo)),
        `${model.logo} does not exist`
      ).toBe(true);
    }
  });

  it('keeps council defaults inside the registry', () => {
    const ids = new Set<string>(CHAT_MODELS.map((model) => model.id));
    expect(COUNCIL_MODEL_IDS.length).toBeLessThanOrEqual(4);
    expect(ids.has(COUNCIL_CHAIR_MODEL)).toBe(true);
    for (const id of COUNCIL_MODEL_IDS) expect(ids.has(id)).toBe(true);
  });
});
