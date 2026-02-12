interface Message {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}

interface Stage1Result {
  model: string;
  response: string;
}

interface Stage2Result {
  model: string;
  rankingText: string;
  parsedRanking: string[];
}

interface AggregateRanking {
  model: string;
  averageRank: number;
  rankingsCount: number;
}

const COUNCIL_MODELS = [
  "openai/gpt-5.1",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4.5",
  "x-ai/grok-4",
] as const;

const CHAIRMAN_MODEL = "google/gemini-3-pro-preview" as const;

async function createCompletion(
  messages: Array<{ role: string; content: string }>,
  model: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001",
      "X-Title": "ChatterStack",
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error("No response body");
  }

  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();

        if (data === "[DONE]") {
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
}

async function stage1_collect_responses(
  userQuery: string,
  conversationHistory: Message[] = [],
  onProgress?: (stage: string, model: string, progress: number) => void
): Promise<Stage1Result[]> {
  console.log("=== Stage 1: Collecting Council Responses ===");

  const promises = COUNCIL_MODELS.map(async (model) => {
    try {
      if (onProgress) {
        onProgress("stage1", model, 0);
      }

      const messages = [
        ...conversationHistory.map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
        { role: 'user', content: userQuery },
      ];

      let response = "";
      await createCompletion(messages, model, (chunk: string) => {
        response += chunk;
      });

      if (onProgress) {
        onProgress("stage1", model, 100);
      }

      console.log(`Stage 1: ${model} completed`);
      return { model, response } as Stage1Result;
    } catch (error) {
      console.error(`Stage 1: ${model} failed:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  const validResults = results.filter(
    (r): r is Stage1Result => r !== null && r.response.trim().length > 0
  );

  console.log(
    `Stage 1 complete: ${validResults.length}/${COUNCIL_MODELS.length} models succeeded`
  );
  return validResults;
}

function parse_ranking_from_text(text: string): string[] {
  const ranking: string[] = [];

  const finalRankingMatch = text.match(/FINAL RANKING:[\s\S]*$/i);
  if (!finalRankingMatch) {
    console.warn("No FINAL RANKING section found");
    return ranking;
  }

  const rankingSection = finalRankingMatch[0];

  const orderedMatches = rankingSection.matchAll(/\d+\.\s*Response\s+([A-Z])/gi);
  for (const match of orderedMatches) {
    if (match[1]) {
      ranking.push(`Response ${match[1].toUpperCase()}`);
    }
  }

  if (ranking.length === 0) {
    const fallbackMatches = rankingSection.matchAll(/Response\s+([A-Z])/gi);
    for (const match of fallbackMatches) {
      if (match[1]) {
        const label = `Response ${match[1].toUpperCase()}`;
        if (!ranking.includes(label)) {
          ranking.push(label);
        }
      }
    }
  }

  return ranking;
}

async function stage2_collect_rankings(
  userQuery: string,
  stage1Results: Stage1Result[],
  conversationHistory: Message[] = [],
  onProgress?: (stage: string, model: string, progress: number) => void
): Promise<{ stage2Results: Stage2Result[]; labelToModel: Map<string, string> }> {
  console.log("=== Stage 2: Collecting Peer Rankings ===");

  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const labelToModel = new Map<string, string>();
  const anonymizedResponses = stage1Results.map((result, index) => {
    const label = `Response ${labels[index]}`;
    labelToModel.set(label, result.model);
    return {
      label,
      response: result.response,
    };
  });

  const responsesText = anonymizedResponses
    .map((r) => `${r.label}:\n${r.response}\n`)
    .join("\n");

  const contextSummary =
    conversationHistory.length > 0
      ? `\n\nCONVERSATION CONTEXT:\n${conversationHistory
          .slice(-4)
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n")}\n`
      : "";

  const rankingPrompt = `You are an expert evaluator analyzing different AI responses to the same question.
${contextSummary}
ORIGINAL QUESTION:
${userQuery}

RESPONSES TO EVALUATE:
${responsesText}

YOUR TASK:
1. Critically evaluate each response for:
   - Accuracy and correctness
   - Completeness and depth
   - Clarity and organization
   - Practical usefulness
   - Consistency with conversation history (if applicable)
   - Any errors or misconceptions

2. Provide detailed critiques for each response.

3. End with a FINAL RANKING section that lists the responses in order from best to worst.
   Format: Use numbered list like:
   1. Response C
   2. Response A
   3. Response B
   etc.

Be thorough in your analysis and decisive in your ranking.

FINAL RANKING:`;

  const promises = COUNCIL_MODELS.map(async (model) => {
    try {
      if (onProgress) {
        onProgress("stage2", model, 0);
      }

      let rankingText = "";
      await createCompletion(
        [{ role: "user", content: rankingPrompt }],
        model,
        (chunk: string) => {
          rankingText += chunk;
        }
      );

      if (onProgress) {
        onProgress("stage2", model, 100);
      }

      const parsedRanking = parse_ranking_from_text(rankingText);
      console.log(`Stage 2: ${model} ranking:`, parsedRanking);

      return {
        model,
        rankingText,
        parsedRanking,
      } as Stage2Result;
    } catch (error) {
      console.error(`Stage 2: ${model} failed:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  const validResults = results.filter((r): r is Stage2Result => r !== null);

  console.log(
    `Stage 2 complete: ${validResults.length}/${COUNCIL_MODELS.length} models provided rankings`
  );
  return { stage2Results: validResults, labelToModel };
}

function calculate_aggregate_rankings(
  stage2Results: Stage2Result[],
  labelToModel: Map<string, string>
): AggregateRanking[] {
  const modelRanks = new Map<string, number[]>();

  stage2Results.forEach((result) => {
    result.parsedRanking.forEach((label, position) => {
      const model = labelToModel.get(label);
      if (model) {
        if (!modelRanks.has(model)) {
          modelRanks.set(model, []);
        }
        const ranks = modelRanks.get(model);
        if (ranks) {
          ranks.push(position + 1);
        }
      }
    });
  });

  const aggregateRankings: AggregateRanking[] = [];
  modelRanks.forEach((ranks, model) => {
    const averageRank = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
    aggregateRankings.push({
      model,
      averageRank,
      rankingsCount: ranks.length,
    });
  });

  aggregateRankings.sort((a, b) => a.averageRank - b.averageRank);

  return aggregateRankings;
}

async function stage3_synthesize_final(
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[],
  labelToModel: Map<string, string>,
  conversationHistory: Message[] = [],
  onChunk?: (chunk: string) => void
): Promise<string> {
  console.log("=== Stage 3: Chairman Synthesis ===");

  const aggregateRankings = calculate_aggregate_rankings(stage2Results, labelToModel);

  const stage1Context = stage1Results
    .map((r) => `Model: ${r.model}\nResponse: ${r.response}`)
    .join("\n\n---\n\n");

  const stage2Context = stage2Results
    .map((r) => `Model: ${r.model}\nRanking: ${r.rankingText}`)
    .join("\n\n---\n\n");

  const rankingSummary = aggregateRankings
    .map((r, i) => `${i + 1}. ${r.model} (avg rank: ${r.averageRank.toFixed(2)})`)
    .join("\n");

  const contextSummary =
    conversationHistory.length > 0
      ? `\n\nCONVERSATION HISTORY:\n${conversationHistory
          .slice(-6)
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n\n")}\n`
      : "";

  const synthesisPrompt = `You are the chairman of an AI council. Multiple expert AI models have analyzed this question and peer-reviewed each other's responses.
${contextSummary}
CURRENT QUESTION:
${userQuery}

COUNCIL RESPONSES:
${stage1Context}

PEER REVIEWS:
${stage2Context}

AGGREGATE RANKINGS (based on peer review):
${rankingSummary}

YOUR TASK:
Synthesize a comprehensive, authoritative answer that:
1. Incorporates the best insights from all council members
2. Maintains continuity with the conversation history (if any)
3. Resolves disagreements by weighing evidence and rankings
4. Provides a clear, unified response
5. Acknowledges any remaining uncertainties or different perspectives
6. Delivers practical, actionable information

Create the definitive answer that represents the council's collective wisdom.`;

  const chairmanMessages = [
    ...conversationHistory.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: synthesisPrompt },
  ];

  let finalResponse = "";
  await createCompletion(chairmanMessages, CHAIRMAN_MODEL, (chunk: string) => {
    finalResponse += chunk;
    if (onChunk) {
      onChunk(chunk);
    }
  });

  console.log("Stage 3 complete: Chairman synthesis finished");
  return finalResponse;
}

export async function runCouncilProcess(
  userQuery: string,
  conversationHistory: Message[] = [],
  onProgress?: (stage: string, model: string, progress: number) => void,
  onChunk?: (chunk: string) => void
): Promise<string> {
  console.log("=== Starting Council Process ===");

  const stage1Results = await stage1_collect_responses(
    userQuery,
    conversationHistory,
    onProgress
  );

  if (stage1Results.length === 0) {
    throw new Error("No council members provided responses");
  }

  const { stage2Results, labelToModel } = await stage2_collect_rankings(
    userQuery,
    stage1Results,
    conversationHistory,
    onProgress
  );

  if (stage2Results.length === 0) {
    console.warn("No rankings collected, proceeding with basic synthesis");
  }

  const finalResponse = await stage3_synthesize_final(
    userQuery,
    stage1Results,
    stage2Results,
    labelToModel,
    conversationHistory,
    onChunk
  );

  console.log("=== Council Process Complete ===");
  return finalResponse;
}