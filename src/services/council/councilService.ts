/**
 * Council Service - FIXED VERSION
 * 
 * Critical fix: Stage 3 now properly streams chunks to frontend
 */

import {
  getCouncilStage1Prompt,
  getCouncilStage2Prompt,
  getCouncilChairmanPrompt,
} from '../prompt/promptService';

export const COUNCIL_MODELS = [
  "openai/gpt-5.1",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4.5",
  "x-ai/grok-4",
] as const;

export const CHAIRMAN_MODEL = "google/gemini-3-pro-preview" as const;

export type CouncilModel = typeof COUNCIL_MODELS[number];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}

export interface Stage1Result {
  model: CouncilModel;
  response: string;
}

export interface Stage2Result {
  model: CouncilModel;
  rankingText: string;
  parsedRanking: string[];
}

export interface AggregateRanking {
  model: string;
  averageRank: number;
  rankingsCount: number;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createCompletion(
  messages: Array<{ role: string; content: string }>,
  model: string,
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
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'X-Title': 'ChatterStack',
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: !!onChunk,
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
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

async function stage1_collect_responses(
  userQuery: string,
  conversationHistory: Message[] = [],
  onProgress?: (stage: string, model: string, progress: number) => void
): Promise<Stage1Result[]> {
  console.log('=== Stage 1: Collecting Council Responses ===');
  console.log(`Conversation history: ${conversationHistory.length} messages`);

  const systemPrompt = getCouncilStage1Prompt();

  const promises = COUNCIL_MODELS.map(async (model, index) => {
    try {
      await delay(index * 1000);
      
      if (onProgress) {
        onProgress('stage1', model, 0);
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
        { role: 'user', content: userQuery },
      ];

      let response = '';
      await createCompletion(messages, model, (chunk: string) => {
        response += chunk;
      });

      if (onProgress) {
        onProgress('stage1', model, 100);
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

  console.log(`Stage 1 complete: ${validResults.length}/${COUNCIL_MODELS.length} models succeeded`);
  return validResults;
}

function parse_ranking_from_text(text: string): string[] {
  const ranking: string[] = [];

  const finalRankingMatch = text.match(/FINAL RANKING:[\s\S]*$/i);
  if (!finalRankingMatch) {
    console.warn('No FINAL RANKING section found');
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
  console.log('=== Stage 2: Collecting Peer Rankings ===');

  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const labelToModel = new Map<string, string>();
  const anonymizedResponses = stage1Results.map((result, index) => {
    const label = `Response ${labels[index]}`;
    labelToModel.set(label, result.model);
    return {
      label,
      response: result.response,
    };
  });

  const rankingPrompt = getCouncilStage2Prompt(userQuery, anonymizedResponses);

  const stage2Results: Stage2Result[] = [];
  
  for (let i = 0; i < COUNCIL_MODELS.length; i++) {
    const model = COUNCIL_MODELS[i];
    
    try {
      if (i > 0) {
        await delay(2000);
      }
      
      if (onProgress) {
        onProgress('stage2', model, 0);
      }

      let rankingText = '';
      await createCompletion(
        [{ role: 'user', content: rankingPrompt }],
        model,
        (chunk: string) => {
          rankingText += chunk;
        }
      );

      if (onProgress) {
        onProgress('stage2', model, 100);
      }

      const parsedRanking = parse_ranking_from_text(rankingText);
      console.log(`Stage 2: ${model} ranking:`, parsedRanking);

      stage2Results.push({
        model,
        rankingText,
        parsedRanking,
      });
    } catch (error) {
      console.error(`Stage 2: ${model} failed:`, error);
    }
  }

  console.log(
    `Stage 2 complete: ${stage2Results.length}/${COUNCIL_MODELS.length} models provided rankings`
  );
  
  if (stage2Results.length >= 2) {
    console.log('Sufficient rankings collected, proceeding with synthesis');
  } else {
    console.log('No rankings collected, proceeding with basic synthesis');
  }
  
  return { stage2Results, labelToModel };
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
  onChunk?: (chunk: string) => void  // THIS IS THE CRITICAL CALLBACK!
): Promise<string> {
  console.log('=== Stage 3: Chairman Synthesis ===');

  const aggregateRankings = calculate_aggregate_rankings(stage2Results, labelToModel);

  const chairmanPrompt = getCouncilChairmanPrompt(
    userQuery,
    stage1Results,
    aggregateRankings,
    conversationHistory
  );

  const chairmanMessages = [
    { role: 'system', content: chairmanPrompt },
    ...conversationHistory.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userQuery },
  ];

  let finalResponse = '';
  
  await createCompletion(chairmanMessages, CHAIRMAN_MODEL, (chunk: string) => {
    finalResponse += chunk;
    if (onChunk) {
      onChunk(chunk);  
    }
  });

  console.log('Stage 3 complete: Chairman synthesis finished');
  return finalResponse;
}

export async function runCouncilProcess(
  userQuery: string,
  conversationHistory: Message[] = [],
  onProgress?: (stage: string, model: string, progress: number) => void,
  onChunk?: (chunk: string) => void 
): Promise<string> {
  console.log('=== Starting Council Process ===');
  console.log(`With conversation history: ${conversationHistory.length} messages`);

  const stage1Results = await stage1_collect_responses(
    userQuery,
    conversationHistory,
    onProgress
  );

  if (stage1Results.length === 0) {
    throw new Error('No council members provided responses');
  }

  const { stage2Results, labelToModel } = await stage2_collect_rankings(
    userQuery,
    stage1Results,
    conversationHistory,
    onProgress
  );

  if (stage2Results.length === 0) {
    console.warn('No rankings collected, proceeding with basic synthesis');
  }

  const finalResponse = await stage3_synthesize_final(
    userQuery,
    stage1Results,
    stage2Results,
    labelToModel,
    conversationHistory,
    onChunk 
  );

  console.log('=== Council Process Complete ===');
  return finalResponse;
}