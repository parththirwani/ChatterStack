import { Role } from "../types";
import { createCompletion } from "../openrouter";
import {
  COUNCIL_MODELS,
  CHAIRMAN_MODEL,
  Stage1Result,
  Stage2Result,
  AggregateRanking,
} from "../config/council";

/**
 * Stage 1: Collect parallel responses from all council models
 */
export async function stage1_collect_responses(
  userQuery: string,
  onProgress?: (stage: string, model: string, progress: number) => void
): Promise<Stage1Result[]> {
  console.log("=== Stage 1: Collecting Council Responses ===");

  const promises = COUNCIL_MODELS.map(async (model, index) => {
    try {
      if (onProgress) {
        onProgress("stage1", model, 0);
      }

      let response = "";
      await createCompletion(
        [{ role: Role.User, content: userQuery }],
        model,
        (chunk: string) => {
          response += chunk;
        }
      );

      if (onProgress) {
        onProgress("stage1", model, 100);
      }

      console.log(`Stage 1: ${model} completed`);
      return { model, response };
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

/**
 * Parse ranking from model's response text
 */
function parse_ranking_from_text(text: string): string[] {
  const ranking: string[] = [];

  // Look for "FINAL RANKING:" section
  const finalRankingMatch = text.match(/FINAL RANKING:[\s\S]*$/i);
  if (!finalRankingMatch) {
    console.warn("No FINAL RANKING section found");
    return ranking;
  }

  const rankingSection = finalRankingMatch[0];

  // Extract ordered responses like "1. Response C"
  const orderedMatches = rankingSection.matchAll(/\d+\.\s*Response\s+([A-Z])/gi);
  for (const match of orderedMatches) {
    ranking.push(`Response ${match[1].toUpperCase()}`);
  }

  // Fallback: just find all "Response X" mentions in order
  if (ranking.length === 0) {
    const fallbackMatches = rankingSection.matchAll(/Response\s+([A-Z])/gi);
    for (const match of fallbackMatches) {
      const label = `Response ${match[1].toUpperCase()}`;
      if (!ranking.includes(label)) {
        ranking.push(label);
      }
    }
  }

  return ranking;
}

/**
 * Stage 2: Collect anonymized peer rankings
 */
export async function stage2_collect_rankings(
  userQuery: string,
  stage1Results: Stage1Result[],
  onProgress?: (stage: string, model: string, progress: number) => void
): Promise<{ stage2Results: Stage2Result[]; labelToModel: Map<string, string> }> {
  console.log("=== Stage 2: Collecting Peer Rankings ===");

  // Anonymize responses
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

  // Build ranking prompt
  const responsesText = anonymizedResponses
    .map((r) => `${r.label}:\n${r.response}\n`)
    .join("\n");

  const rankingPrompt = `You are an expert evaluator analyzing different AI responses to the same question.

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

  // Query all models in parallel for rankings
  const promises = COUNCIL_MODELS.map(async (model) => {
    try {
      if (onProgress) {
        onProgress("stage2", model, 0);
      }

      let rankingText = "";
      await createCompletion(
        [{ role: Role.User, content: rankingPrompt }],
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
      };
    } catch (error) {
      console.error(`Stage 2: ${model} failed:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  const validResults = results.filter((r): r is Stage2Result => r !== null);

  console.log(`Stage 2 complete: ${validResults.length}/${COUNCIL_MODELS.length} models provided rankings`);
  return { stage2Results: validResults, labelToModel };
}

/**
 * Calculate aggregate rankings from all peer reviews
 */
function calculate_aggregate_rankings(
  stage2Results: Stage2Result[],
  labelToModel: Map<string, string>
): AggregateRanking[] {
  const modelRanks = new Map<string, number[]>();

  // Collect all ranks for each model
  stage2Results.forEach((result) => {
    result.parsedRanking.forEach((label, position) => {
      const model = labelToModel.get(label);
      if (model) {
        if (!modelRanks.has(model)) {
          modelRanks.set(model, []);
        }
        modelRanks.get(model)!.push(position + 1); // position is 0-indexed, rank is 1-indexed
      }
    });
  });

  // Calculate average ranks
  const aggregateRankings: AggregateRanking[] = [];
  modelRanks.forEach((ranks, model) => {
    const averageRank = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
    aggregateRankings.push({
      model,
      averageRank,
      rankingsCount: ranks.length,
    });
  });

  // Sort by average rank (lower is better)
  aggregateRankings.sort((a, b) => a.averageRank - b.averageRank);

  return aggregateRankings;
}

/**
 * Stage 3: Chairman synthesizes final response
 */
export async function stage3_synthesize_final(
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[],
  labelToModel: Map<string, string>,
  onChunk?: (chunk: string) => void
): Promise<string> {
  console.log("=== Stage 3: Chairman Synthesis ===");

  // Calculate aggregate rankings
  const aggregateRankings = calculate_aggregate_rankings(stage2Results, labelToModel);

  // Build context from Stage 1
  const stage1Context = stage1Results
    .map((r) => `Model: ${r.model}\nResponse: ${r.response}`)
    .join("\n\n---\n\n");

  // Build context from Stage 2
  const stage2Context = stage2Results
    .map((r) => `Model: ${r.model}\nRanking: ${r.rankingText}`)
    .join("\n\n---\n\n");

  // Build ranking summary
  const rankingSummary = aggregateRankings
    .map((r, i) => `${i + 1}. ${r.model} (avg rank: ${r.averageRank.toFixed(2)})`)
    .join("\n");

  const synthesisPrompt = `You are the chairman of an AI council. Multiple expert AI models have analyzed this question and peer-reviewed each other's responses.

ORIGINAL QUESTION:
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
2. Resolves disagreements by weighing evidence and rankings
3. Provides a clear, unified response
4. Acknowledges any remaining uncertainties or different perspectives
5. Delivers practical, actionable information

Create the definitive answer that represents the council's collective wisdom.`;

  let finalResponse = "";
  await createCompletion(
    [{ role: Role.User, content: synthesisPrompt }],
    CHAIRMAN_MODEL,
    (chunk: string) => {
      finalResponse += chunk;
      if (onChunk) {
        onChunk(chunk);
      }
    }
  );

  console.log("Stage 3 complete: Chairman synthesis finished");
  return finalResponse;
}

/**
 * Full council process
 */
export async function runCouncilProcess(
  userQuery: string,
  onProgress?: (stage: string, model: string, progress: number) => void,
  onChunk?: (chunk: string) => void
): Promise<string> {
  console.log("=== Starting Council Process ===");

  // Stage 1: Collect responses
  const stage1Results = await stage1_collect_responses(userQuery, onProgress);

  if (stage1Results.length === 0) {
    throw new Error("No council members provided responses");
  }

  // Stage 2: Collect rankings
  const { stage2Results, labelToModel } = await stage2_collect_rankings(
    userQuery,
    stage1Results,
    onProgress
  );

  if (stage2Results.length === 0) {
    console.warn("No rankings collected, proceeding with basic synthesis");
  }

  // Stage 3: Synthesize final response
  const finalResponse = await stage3_synthesize_final(
    userQuery,
    stage1Results,
    stage2Results,
    labelToModel,
    onChunk
  );

  console.log("=== Council Process Complete ===");
  return finalResponse;
}