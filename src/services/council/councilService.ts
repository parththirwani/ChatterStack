/**
 * Council Service
 *
 * Stage 1: each member answers independently.
 * Stage 2: each member ranks the anonymized answers.
 * Stage 3: the chair synthesizes a final answer from both.
 */

import {
  getCouncilStage1Prompt,
  getCouncilStage2Prompt,
  getCouncilChairmanPrompt,
} from '../prompt/promptService';
import { COUNCIL_CHAIR_MODEL, COUNCIL_MODEL_IDS, type ThinkingLevel } from '@/src/config/models';
import { streamCompletion } from '@/src/lib/api/chat/openrouter';
import type { StreamTrace } from '@/src/lib/api/chat/openrouter';
import type { CouncilAnswer, CouncilRanking } from '@/src/types/chat.types';
import type { OpenRouterPart } from '@/src/lib/api/chat/attachments';

const COUNCIL_MODELS: readonly string[] = COUNCIL_MODEL_IDS;

const CHAIRMAN_MODEL: string = COUNCIL_CHAIR_MODEL;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  /** The message as sent to members, including any files it carried. */
  parts?: string | OpenRouterPart[];
}

export interface Stage1Result {
  model: string;
  response: string;
}

export interface Stage2Result {
  model: string;
  rankingText: string;
  parsedRanking: string[];
}

export interface AggregateRanking {
  model: string;
  averageRank: number;
  rankingsCount: number;
}

export interface CouncilOptions {
  members?: readonly string[];
  chair?: string;
  thinkingLevel?: ThinkingLevel;
  /** Stops the deliberation (the user stopped or disconnected). */
  signal?: AbortSignal;
  /** Shared trace id + request context, recorded for every stage. */
  trace?: Omit<StreamTrace, 'span' | 'thinkingLevel'>;
}

export interface CouncilCallbacks {
  onProgress?: (stage: string, model: string, progress: number) => void;
  onChunk?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onAnswer?: (answer: CouncilAnswer) => void;
  onRankings?: (rankings: CouncilRanking[]) => void;
}

// Members start a second apart so a council doesn't burst the provider's rate limit.
const MEMBER_STAGGER_MS = 1000;

/** Resolves after `ms`, or right away once `signal` aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function stage1_collect_responses(
  userQuery: string,
  attachmentContent: OpenRouterPart[],
  conversationHistory: Message[],
  members: readonly string[],
  thinkingLevel: ThinkingLevel,
  signal: AbortSignal | undefined,
  { onProgress, onAnswer }: CouncilCallbacks,
  trace: CouncilOptions['trace']
): Promise<Stage1Result[]> {

  const systemPrompt = getCouncilStage1Prompt();

  const promises = members.map(async (model, index) => {
    try {
      await delay(index * MEMBER_STAGGER_MS, signal);
      if (signal?.aborted) return null;
      onProgress?.('stage1', model, 0);

      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.parts ?? m.content,
        })),
        { role: 'user', content: attachmentContent.length ? [{ type: 'text' as const, text: userQuery || 'Please examine the attached file(s).' }, ...attachmentContent] : userQuery },
      ];

      const response = await streamCompletion(messages, model, {
        thinkingLevel,
        signal,
        trace: trace && { ...trace, span: 'council-member-answer', thinkingLevel, messageCount: messages.length },
      });
      if (signal?.aborted) return null;
      if (!response.trim()) throw new Error('Empty response');

      onProgress?.('stage1', model, 100);
      onAnswer?.({ model, response });

      return { model, response } as Stage1Result;
    } catch (error) {
      console.error(`Stage 1: ${model} failed:`, error);
      onProgress?.('stage1', model, -1);
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter((r): r is Stage1Result => r !== null);
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
  thinkingLevel: ThinkingLevel,
  signal: AbortSignal | undefined,
  onProgress: ((stage: string, model: string, progress: number) => void) | undefined,
  trace: CouncilOptions['trace']
): Promise<{ stage2Results: Stage2Result[]; labelToModel: Map<string, string> }> {

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

  // Only members that produced an answer take part in peer review. They rank
  // in parallel (staggered like stage 1): with reasoning on, each ranking can
  // take tens of seconds, so running them one after another added minutes.
  const results = await Promise.all(
    stage1Results.map(async ({ model }, index): Promise<Stage2Result | null> => {
      await delay(index * MEMBER_STAGGER_MS, signal);
      if (signal?.aborted) return null;
      try {
        onProgress?.('stage2', model, 0);
        const rankingMessages = [{ role: 'user', content: rankingPrompt }];
        const rankingText = await streamCompletion(rankingMessages, model, {
          thinkingLevel,
          signal,
          trace: trace && { ...trace, span: 'council-ranking', thinkingLevel, messageCount: rankingMessages.length },
        });
        if (signal?.aborted) return null;
        onProgress?.('stage2', model, 100);
        return { model, rankingText, parsedRanking: parse_ranking_from_text(rankingText) };
      } catch (error) {
        console.error(`Stage 2: ${model} failed:`, error);
        onProgress?.('stage2', model, -1);
        return null;
      }
    })
  );

  return { stage2Results: results.filter((r): r is Stage2Result => r !== null), labelToModel };
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
  aggregateRankings: AggregateRanking[],
  conversationHistory: Message[],
  chair: string,
  thinkingLevel: ThinkingLevel,
  signal: AbortSignal | undefined,
  { onProgress, onChunk, onReasoning }: CouncilCallbacks,
  trace: CouncilOptions['trace']
): Promise<string> {

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

  try {
    onProgress?.('stage3', chair, 0);
    const finalResponse = await streamCompletion(chairmanMessages, chair, {
      thinkingLevel,
      onChunk,
      onReasoning,
      signal,
      trace: trace && { ...trace, span: 'council-chair', thinkingLevel, messageCount: chairmanMessages.length },
    });
    onProgress?.('stage3', chair, 100);
    return finalResponse;
  } catch (error) {
    console.error('Stage 3 failed:', error);
    onProgress?.('stage3', chair, -1);
    throw new Error('Failed to synthesize final response');
  }
}

/**
 * Runs the three council stages and returns the chair's answer. Throws if no
 * member could answer or the chair fails; returns what the chair wrote so far
 * (possibly '') if `signal` aborts.
 */
export async function runCouncilProcess(
  userQuery: string,
  conversationHistory: Message[] = [],
  { members = COUNCIL_MODELS, chair = CHAIRMAN_MODEL, thinkingLevel = 'off', signal, trace }: CouncilOptions = {},
  callbacks: CouncilCallbacks = {},
  attachmentContent: OpenRouterPart[] = []
): Promise<string> {
  const { onProgress, onRankings } = callbacks;

  const stage1Results = await stage1_collect_responses(
    userQuery,
    attachmentContent,
    conversationHistory,
    members,
    thinkingLevel,
    signal,
    callbacks,
    trace
  );
  if (signal?.aborted) return '';
  if (stage1Results.length === 0) {
    throw new Error('No council member could answer. Please try again.');
  }

  const { stage2Results, labelToModel } = await stage2_collect_rankings(
    userQuery,
    stage1Results,
    thinkingLevel,
    signal,
    onProgress,
    trace
  );
  if (signal?.aborted) return '';
  if (stage2Results.length === 0) {
    console.warn('No rankings collected, proceeding with basic synthesis');
  }

  const aggregateRankings = calculate_aggregate_rankings(stage2Results, labelToModel);
  onRankings?.(aggregateRankings.map(({ model, averageRank }) => ({ model, averageRank })));

  return stage3_synthesize_final(
    userQuery,
    stage1Results,
    aggregateRankings,
    conversationHistory,
    chair,
    thinkingLevel,
    signal,
    callbacks,
    trace
  );
}
