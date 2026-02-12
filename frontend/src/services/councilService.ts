interface Message {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}

interface CouncilMember {
  id: string;
  name: string;
  model: string;
  expertise: string;
}

const COUNCIL_MEMBERS: CouncilMember[] = [
  {
    id: 'analyst',
    name: 'The Analyst',
    model: 'anthropic/claude-3.5-sonnet',
    expertise: 'analytical thinking, problem decomposition, logical reasoning',
  },
  {
    id: 'creative',
    name: 'The Creative',
    model: 'google/gemini-pro-1.5',
    expertise: 'creative solutions, lateral thinking, innovative approaches',
  },
  {
    id: 'synthesizer',
    name: 'The Synthesizer',
    model: 'google/gemini-3-pro-preview',
    expertise: 'synthesis, combining perspectives, comprehensive solutions',
  },
];

async function callModel(
  model: string,
  messages: Array<{ role: string; content: string }>,
  onChunk?: (chunk: string) => void
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001',
      'X-Title': 'ChatterStack Council',
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: !!onChunk,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  if (onChunk) {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            return fullContent;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;

            if (content) {
              fullContent += content;
              onChunk(content);
            }
          } catch (e) {
            // Ignore invalid JSON chunks
          }
        }
      }
    }

    return fullContent;
  } else {
    const data = await response.json();
    return data.choices[0].message.content;
  }
}

export async function runCouncilProcess(
  userMessage: string,
  conversationHistory: Message[],
  onProgress: (stage: string, model: string, progress: number) => void,
  onChunk: (chunk: string) => void
): Promise<string> {
  const contextMessages = conversationHistory.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  // Stage 1: Gather perspectives from each council member
  const perspectives: { member: CouncilMember; response: string }[] = [];

  for (let i = 0; i < COUNCIL_MEMBERS.length; i++) {
    const member = COUNCIL_MEMBERS[i];
    onProgress('gathering', member.name, (i / COUNCIL_MEMBERS.length) * 100);

    const prompt = `You are ${member.name}, specializing in ${member.expertise}.

Provide your perspective on the following question, focusing on your area of expertise. Be concise but insightful.

Question: ${userMessage}`;

    const response = await callModel(
      member.model,
      [
        ...contextMessages,
        {
          role: 'user',
          content: prompt,
        },
      ]
    );

    perspectives.push({ member, response });
  }

  // Stage 2: Synthesize all perspectives
  onProgress('synthesizing', 'The Synthesizer', 0);

  const synthesisPrompt = `You are The Synthesizer. Your role is to combine the following perspectives into a comprehensive, coherent response.

User's Question: ${userMessage}

Perspectives from the council:

${perspectives
  .map(
    (p) => `**${p.member.name}** (${p.member.expertise}):
${p.response}`
  )
  .join('\n\n')}

Synthesize these perspectives into a single, well-structured response that:
1. Addresses the user's question directly
2. Integrates the best insights from each perspective
3. Resolves any contradictions or tensions between perspectives
4. Provides actionable recommendations where appropriate

Provide the synthesized response now:`;

  const finalResponse = await callModel(
    COUNCIL_MEMBERS[2].model, // The Synthesizer model
    [
      ...contextMessages,
      {
        role: 'user',
        content: synthesisPrompt,
      },
    ],
    onChunk
  );

  return finalResponse;
}