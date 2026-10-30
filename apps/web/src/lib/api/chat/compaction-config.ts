/** Small, fixed utility model so summary cost and context are predictable. */
export const DEFAULT_COMPACTION_MODEL = 'openai/gpt-4o-mini';

/**
 * `off`    - never compact; an over-limit history is refused before the call.
 * `shadow` - measure would-trigger turns and log them, but send full history.
 * `on`     - generate and use snapshots when the trigger is crossed.
 */
export type CompactionMode = 'off' | 'shadow' | 'on';

export const COMPACTION_LIMITS = {
  /** Compact once the rendered request crosses this share of the input budget. */
  triggerRatio: 0.65,
  /** Never wait for a very large model's window to fill before compacting. */
  triggerMaxTokens: 80_000,
  /** Aim for this share of the input budget after a summary. */
  targetRatio: 0.35,
  /** Completed exchanges always sent verbatim after the summary. */
  recentExchanges: 2,
  /** Hard cap for generated summary text. */
  summaryMaxTokens: 1600,
  /** Schema version stored with each snapshot. */
  schemaVersion: 1,
} as const;

export function compactionMode(): CompactionMode {
  const raw = process.env.CHAT_COMPACTION_MODE?.trim().toLowerCase();
  return raw === 'on' || raw === 'shadow' ? raw : 'off';
}

/** Small, fixed utility model so summary cost and context are predictable. */
export function compactionModel(): string {
  return process.env.COMPACTION_MODEL?.trim() || DEFAULT_COMPACTION_MODEL;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Completed exchanges always kept verbatim; at least one. */
export function recentExchangeCount(): number {
  return Math.max(1, Math.floor(envNumber('COMPACTION_RECENT_EXCHANGES', COMPACTION_LIMITS.recentExchanges)));
}

export function triggerTokens(inputBudget: number): number {
  const ratio = envNumber('COMPACTION_TRIGGER_RATIO', COMPACTION_LIMITS.triggerRatio);
  const max = envNumber('COMPACTION_TRIGGER_MAX_TOKENS', COMPACTION_LIMITS.triggerMaxTokens);
  return Math.min(Math.floor(inputBudget * ratio), max);
}

export function targetTokens(inputBudget: number): number {
  return Math.floor(inputBudget * COMPACTION_LIMITS.targetRatio);
}
