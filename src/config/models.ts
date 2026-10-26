// OpenRouter model IDs verified against https://openrouter.ai/api/v1/models on 2026-10-26.
// Pricing is in USD per token; it is informational and may change upstream.
export const CHAT_MODELS = [
  {
    id: 'deepseek/deepseek-v4.1-flash-1017',
    name: 'DeepSeek V4.1 Flash',
    description: 'Fast reasoning and coding · Oct 2026',
    logo: '/deepseek.svg',
    company: 'DeepSeek',
    contextLength: 1048576,
    pricing: { prompt: 0.00000015, completion: 0.0000006 },
  },
  {
    id: 'google/gemini-4-argon',
    name: 'Gemini 4 Argon',
    description: 'Google’s latest flagship reasoning model',
    logo: '/gemini.svg',
    company: 'Google',
    contextLength: 1048576,
    pricing: { prompt: 0.000002, completion: 0.00001 },
  },
  {
    id: 'openai/gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    description: 'Coding, analysis, and everyday work',
    logo: '/openai.svg',
    company: 'OpenAI',
    contextLength: 1050000,
    pricing: { prompt: 0.000002, completion: 0.00001 },
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    description: 'Writing, coding, and detailed analysis',
    logo: '/claude.svg',
    company: 'Anthropic',
    contextLength: 1000000,
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

export const COUNCIL_DESCRIPTION = `Up to four models: ${COUNCIL_MODEL_IDS.map(
  (id) => CHAT_MODELS.find((model) => model.id === id)?.name
).join(', ')}. Daily limit.`;
