export interface ModelMeta {
  id: string;
  name: string;
  logo: string;
  company: string;
  invert?: boolean;
}

const MODEL_META: Record<string, ModelMeta> = {
  'deepseek/deepseek-chat-v3.1': {
    id: 'deepseek/deepseek-chat-v3.1',
    name: 'DeepSeek',
    logo: '/deepseek.svg',
    company: 'DeepSeek',
  },
  'google/gemini-2.5-flash': {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini',
    logo: '/gemini.svg',
    company: 'Google',
  },
  'google/gemini-3-pro-preview': {
    id: 'google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    logo: '/gemini.svg',
    company: 'Google',
  },
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    logo: '/openai.svg',
    company: 'OpenAI',
    invert: true,
  },
  'openai/gpt-5.1': {
    id: 'openai/gpt-5.1',
    name: 'GPT-5.1',
    logo: '/openai.svg',
    company: 'OpenAI',
    invert: true,
  },
  'anthropic/claude-sonnet-4.5': {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude 4.5',
    logo: '/claude.svg',
    company: 'Anthropic',
  },
  'x-ai/grok-4': {
    id: 'x-ai/grok-4',
    name: 'Grok 4',
    logo: '/grok.svg',
    company: 'xAI',
    invert: true,
  },
  council: {
    id: 'council',
    name: 'AI Council',
    logo: '/logo.png',
    company: 'ChatterStack',
  },
};

export function getModelMeta(id: string | undefined): ModelMeta | null {
  if (!id) return null;
  return MODEL_META[id] ?? null;
}
