// Council configuration
export const COUNCIL_MODELS = [
  "openai/gpt-5.1",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4.5",
  "x-ai/grok-4",
] as const;

export const CHAIRMAN_MODEL = "google/gemini-3-pro-preview";

export type CouncilModel = typeof COUNCIL_MODELS[number];

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