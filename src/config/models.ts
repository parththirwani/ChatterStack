// OpenRouter model IDs verified against https://openrouter.ai/api/v1/models on 2026-10-26.
// Pricing is in USD per token; it is informational and may change upstream.
// thinkingLevels mirror each model's `reasoning.supported_efforts` from the same
// catalog ('off' = effort 'none'); models without 'off' always reason.
export const CHAT_MODELS = [
  {
    id: 'deepseek/deepseek-v4.1-flash-1017',
    name: 'DeepSeek V4.1 Flash',
    description: 'Fast reasoning and coding · Oct 2026',
    logo: '/deepseek.svg',
    company: 'DeepSeek',
    contextLength: 1048576,
    thinkingLevels: ['off', 'low', 'high', 'max'] as readonly ThinkingLevel[],
    pricing: { prompt: 0.00000015, completion: 0.0000006 },
  },
  {
    id: 'google/gemini-4-argon',
    name: 'Gemini 4 Argon',
    description: 'Google’s latest flagship reasoning model',
    logo: '/gemini.svg',
    company: 'Google',
    contextLength: 1048576,
    thinkingLevels: ['low', 'medium', 'high'] as readonly ThinkingLevel[],
    pricing: { prompt: 0.000002, completion: 0.00001 },
  },
  {
    id: 'openai/gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    description: 'Coding, analysis, and everyday work',
    logo: '/openai.svg',
    company: 'OpenAI',
    contextLength: 1050000,
    thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as readonly ThinkingLevel[],
    pricing: { prompt: 0.000002, completion: 0.00001 },
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    description: 'Writing, coding, and detailed analysis',
    logo: '/claude.svg',
    company: 'Anthropic',
    contextLength: 1000000,
    thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as readonly ThinkingLevel[],
    pricing: { prompt: 0.000002, completion: 0.00001 },
  },
] as const;

export const DEFAULT_MODEL_ID = CHAT_MODELS[0].id;

export const COUNCIL_MODEL_IDS = [
  'openai/gpt-6.1-sol',
  'google/gemini-4-argon',
  'anthropic/claude-sonnet-5.5',
  'deepseek/deepseek-v4.1-flash-1017',
] as const;

export const COUNCIL_CHAIR_MODEL = 'google/gemini-4-argon' as const;

export const COUNCIL_MIN_MEMBERS = 2;
export const COUNCIL_MAX_MEMBERS = 4;

// Ordered from least to most reasoning.
export const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

export const THINKING_LEVEL_HINTS: Record<ThinkingLevel, string> = {
  off: 'Fastest replies, no extended reasoning.',
  low: 'Brief reasoning for quick questions.',
  medium: 'Balanced speed and care.',
  high: 'Careful reasoning for harder problems.',
  xhigh: 'Extended reasoning for complex work.',
  max: 'Deepest, slowest reasoning.',
};

export type ChatModelId = (typeof CHAT_MODELS)[number]['id'];

export function isChatModelId(id: string): id is ChatModelId {
  return CHAT_MODELS.some((model) => model.id === id);
}

export function getThinkingLevels(id: string): readonly ThinkingLevel[] {
  return CHAT_MODELS.find((model) => model.id === id)?.thinkingLevels ?? ['off'];
}

export function modelSupportsReasoning(id: string): boolean {
  return getThinkingLevels(id).some((level) => level !== 'off');
}

/** The closest level in `supported`, rounding down on a tie (faster and cheaper). */
export function closestThinkingLevel(supported: readonly ThinkingLevel[], preferred: ThinkingLevel): ThinkingLevel {
  if (supported.includes(preferred)) return preferred;
  const target = THINKING_LEVELS.indexOf(preferred);
  return supported.reduce((best, level) =>
    Math.abs(THINKING_LEVELS.indexOf(level) - target) < Math.abs(THINKING_LEVELS.indexOf(best) - target) ? level : best
  );
}

/** The level a model actually runs at for the user's preferred level. */
export function effectiveThinkingLevel(id: string, preferred: ThinkingLevel): ThinkingLevel {
  return closestThinkingLevel(getThinkingLevels(id), preferred);
}

export const COUNCIL_DESCRIPTION = `Up to four models: ${COUNCIL_MODEL_IDS.map(
  (id) => CHAT_MODELS.find((model) => model.id === id)?.name
).join(', ')}. Daily limit.`;

// Small, fast model for naming chats. Verified on OpenRouter 2026-10-26.
export const TITLE_MODEL = 'openai/gpt-5.6-luna' as const;
