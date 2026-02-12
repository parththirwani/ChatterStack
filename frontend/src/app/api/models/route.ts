import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';

interface Model {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

const AVAILABLE_MODELS: Model[] = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Most intelligent model for complex tasks',
    contextLength: 200000,
    pricing: {
      prompt: 0.003,
      completion: 0.015,
    },
  },
  {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    description: 'Fast and cost-effective for simple tasks',
    contextLength: 200000,
    pricing: {
      prompt: 0.00025,
      completion: 0.00125,
    },
  },
  {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini Pro 1.5',
    description: 'Google\'s advanced model with large context',
    contextLength: 1000000,
    pricing: {
      prompt: 0.00125,
      completion: 0.005,
    },
  },
  {
    id: 'google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    description: 'Latest Gemini model with enhanced capabilities',
    contextLength: 1000000,
    pricing: {
      prompt: 0.002,
      completion: 0.008,
    },
  },
  {
    id: 'openai/gpt-4-turbo',
    name: 'GPT-4 Turbo',
    description: 'OpenAI\'s most capable model',
    contextLength: 128000,
    pricing: {
      prompt: 0.01,
      completion: 0.03,
    },
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Optimized GPT-4 for speed and efficiency',
    contextLength: 128000,
    pricing: {
      prompt: 0.005,
      completion: 0.015,
    },
  },
  {
    id: 'meta-llama/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B',
    description: 'Meta\'s largest open model',
    contextLength: 128000,
    pricing: {
      prompt: 0.003,
      completion: 0.003,
    },
  },
  {
    id: 'council',
    name: 'Council Mode',
    description: 'Multiple AI models collaborate to answer',
    contextLength: 200000,
    pricing: {
      prompt: 0.01,
      completion: 0.04,
    },
  },
];

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({ models: AVAILABLE_MODELS });
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch models',
      },
      { status: 500 }
    );
  }
}