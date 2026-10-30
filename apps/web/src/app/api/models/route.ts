import { NextResponse } from 'next/server';
import { auth } from '@/src/lib/auth';
import { CHAT_MODELS, COUNCIL_DESCRIPTION } from '@/src/config/models';

// Pricing is the OpenRouter catalog's USD-per-token rate at the time of the
// model update. Council pricing varies with the number of successful rounds.
const availableModels = [
  ...CHAT_MODELS.map(({ id, name, description, contextLength, pricing }) => ({
    id, name, description, contextLength, pricing,
  })),
  {
    id: 'council',
    name: 'AI Council',
    description: COUNCIL_DESCRIPTION,
    contextLength: Math.min(...CHAT_MODELS.map((model) => model.contextLength)),
    pricing: null,
  },
];

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({ models: availableModels });
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch models' },
      { status: 500 }
    );
  }
}
