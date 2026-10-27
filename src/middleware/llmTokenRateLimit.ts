// src/middleware/llmTokenRateLimit.ts
// LLM Token-based 24-hour sliding window rate limiting
// - 4000 LLM tokens per 24 hours (input + output tokens)
// - 2 council messages per 24 hours (separate limit)
//
// Usage is tracked in Redis (one sorted set per user) so the caps hold
// across serverless instances and survive cold starts. The check and the
// reservation happen in a single atomic Lua script, so concurrent requests
// can never both spend the same budget. A request reserves an estimate of
// the full prompt (history + message + attachments) and reconciles the
// reservation with the actual usage once the call finishes.
//
// If Redis is unavailable:
// - production: requests fail closed with a 503;
// - development/test: falls back to the old in-process limiter (with a
//   console warning) so local work does not need a Redis server.

import { encode } from 'gpt-tokenizer';
import { randomUUID } from 'crypto';
import { redisStore } from '@/src/lib/redis';

interface TokenRecord {
  timestamp: number;
  tokens: number;
  type: 'regular' | 'council';
  /** True while the record is a pre-flight estimate awaiting reconciliation. */
  pending?: boolean;
}

export interface LimiterDecision {
  allowed: boolean;
  estimatedTokens: number;
  tokensUsed: number;
  tokensLimit: number;
  tokensRemaining: number;
  councilUsed: number;
  councilLimit: number;
  councilRemaining: number;
  resetAt: number;
  retryAfter?: number;
  message?: string;
}

// Configuration
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_LLM_TOKENS = 4000; // 4000 LLM tokens per 24 hours
const MAX_COUNCIL_MESSAGES = 2; // 2 council messages per 24 hours

const redisKey = (userId: string) => `ratelimit:llm-tokens:${userId}`;

/**
 * Redis limiter state is a sorted set per user:
 *   score  = record timestamp (ms)
 *   member = `<tokens>:<council 0|1>:<pending 0|1>:<nonce>`
 * nonce keeps members unique when two records share a timestamp.
 *
 * One script implements all three operations so reads, writes and pruning
 * never interleave between instances:
 *   reserve   - prune the window, check both caps, and atomically add a
 *               pending record for the estimate when allowed;
 *   reconcile - replace the oldest pending record (matching the call type)
 *               with the actual token count, or append when none is left;
 *   status    - read the current usage without writing.
 *
 * Replies are always flat number arrays (Lua numbers survive RESP1).
 */
const LIMITER_SCRIPT = `
local key = KEYS[1]
local op = ARGV[1]
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local maxTokens = tonumber(ARGV[4])
local maxCouncil = tonumber(ARGV[5])
local amount = tonumber(ARGV[6])
local wantCouncil = tonumber(ARGV[7])
local nonce = ARGV[8]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local items = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')

local used = 0
local councilCount = 0
local oldestTs = -1
local oldestCouncilTs = -1
local pendingIndex = -1
local pendingCouncil = -1
local tokens = {}
local scores = {}
for i = 1, #items, 2 do
  local tokensStr, councilStr, pendingStr = string.match(items[i], '^(%-?%d+):(%d):(%d):')
  local recordTokens = tonumber(tokensStr)
  local recordCouncil = tonumber(councilStr)
  local recordPending = tonumber(pendingStr)
  local ts = tonumber(items[i + 1])
  if recordTokens ~= nil and recordCouncil ~= nil and recordPending ~= nil then
    used = used + recordTokens
    if recordCouncil == 1 then
      councilCount = councilCount + 1
      if oldestCouncilTs < 0 then oldestCouncilTs = ts end
    end
    if oldestTs < 0 then oldestTs = ts end
    if pendingIndex < 0 and recordPending == 1 and recordCouncil == wantCouncil then
      pendingIndex = i
      pendingCouncil = ts
    end
    tokens[#tokens + 1] = recordTokens
    scores[#scores + 1] = ts
  end
end

if op == 'reserve' then
  if wantCouncil == 1 and councilCount >= maxCouncil then
    local retryAt = oldestCouncilTs >= 0 and (oldestCouncilTs + window) or now
    return { 0, used, councilCount, 2, retryAt, oldestTs }
  end
  if used + amount > maxTokens then
    local remaining = used
    local retryAt = oldestTs >= 0 and (oldestTs + window) or now
    for i = 1, #scores do
      remaining = remaining - tokens[i]
      if maxTokens - remaining >= amount then
        retryAt = scores[i] + window
        break
      end
    end
    return { 0, used, councilCount, 1, retryAt, oldestTs }
  end
  redis.call('ZADD', key, now, tostring(amount) .. ':' .. wantCouncil .. ':1:' .. nonce)
  redis.call('PEXPIRE', key, window * 2)
  return { 1, used, councilCount, 0, now, oldestTs }
end

if op == 'reconcile' then
  if pendingIndex > 0 then
    redis.call('ZREM', key, items[pendingIndex])
  end
  redis.call('ZADD', key, now, tostring(amount) .. ':' .. wantCouncil .. ':0:' .. nonce)
  redis.call('PEXPIRE', key, window * 2)
  return { 1, pendingCouncil, councilCount, 0, 0 }
end

-- status
return { 1, used, councilCount, oldestTs, oldestCouncilTs }
`;

type LimiterOp = 'reserve' | 'reconcile' | 'status';

async function runLimiterScript(op: LimiterOp, userId: string, amount: number, isCouncil: boolean, nonce: string): Promise<number[]> {
  const reply = await redisStore.evalScript(LIMITER_SCRIPT, {
    keys: [redisKey(userId)],
    arguments: [op, Date.now(), WINDOW_MS, MAX_LLM_TOKENS, MAX_COUNCIL_MESSAGES, Math.round(amount), isCouncil ? 1 : 0, nonce],
  });
  if (!Array.isArray(reply) || reply.some((entry) => entry === null || entry === undefined)) {
    throw new Error(`Unexpected Redis limiter reply: ${JSON.stringify(reply)}`);
  }
  return reply.map(Number);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * In-process fallback used in development/test when Redis is unreachable.
 * Same reserve/reconcile semantics as the Redis backend, but per-instance.
 */
class MemoryTokenLimiter {
  private store: Record<string, TokenRecord[]> = {};
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up old records every hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    // Never keep the process alive just for pruning (tests, scripts).
    this.cleanupInterval.unref?.();
  }

  private cleanup() {
    const cutoff = Date.now() - WINDOW_MS;

    for (const userId in this.store) {
      this.store[userId] = this.store[userId].filter((record) => record.timestamp > cutoff);
      if (this.store[userId].length === 0) {
        delete this.store[userId];
      }
    }
  }

  /** Atomic within the single-threaded JS process: check both caps + reserve. */
  reserve(userId: string, estimatedTokens: number, isCouncil: boolean): LimiterDecision {
    const now = Date.now();
    const records = this.recordsInWindow(userId, now);
    const tokensUsed = records.reduce((sum, record) => sum + record.tokens, 0);
    const councilUsed = records.filter((record) => record.type === 'council').length;
    const decision = this.decide(records, estimatedTokens, isCouncil, tokensUsed, councilUsed);

    if (decision.allowed) {
      if (!this.store[userId]) this.store[userId] = [];
      this.store[userId].push({
        timestamp: now,
        tokens: estimatedTokens,
        type: isCouncil ? 'council' : 'regular',
        pending: true,
      });
    }
    return decision;
  }

  /** Replace the oldest matching pending reservation with the actual usage. */
  record(userId: string, actualTokens: number, isCouncil: boolean): void {
    if (!this.store[userId]) this.store[userId] = [];
    const pending = this.store[userId].find(
      (record) => record.pending && record.type === (isCouncil ? 'council' : 'regular')
    );
    if (pending) {
      pending.tokens = actualTokens;
      pending.pending = false;
    } else {
      this.store[userId].push({
        timestamp: Date.now(),
        tokens: actualTokens,
        type: isCouncil ? 'council' : 'regular',
      });
    }
  }

  getStatus(userId: string) {
    const now = Date.now();
    const records = this.recordsInWindow(userId, now);
    const tokensUsed = records.reduce((sum, record) => sum + record.tokens, 0);
    const councilUsed = records.filter((record) => record.type === 'council').length;
    return buildStatus(now, tokensUsed, councilUsed, this.oldestRecordTs(records));
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }

  /** @internal test hook */
  reset() {
    this.store = {};
  }

  private oldestRecordTs(records: TokenRecord[]): number | undefined {
    return records.length > 0 ? Math.min(...records.map((record) => record.timestamp)) : undefined;
  }

  private recordsInWindow(userId: string, now: number): TokenRecord[] {
    const cutoff = now - WINDOW_MS;
    return (this.store[userId] ?? []).filter((record) => record.timestamp > cutoff);
  }

  private decide(
    records: TokenRecord[],
    estimatedTokens: number,
    isCouncil: boolean,
    tokensUsed: number,
    councilUsed: number
  ): LimiterDecision {
    const now = Date.now();
    const tokensRemaining = Math.max(0, MAX_LLM_TOKENS - tokensUsed);
    const councilRemaining = Math.max(0, MAX_COUNCIL_MESSAGES - councilUsed);

    const oldest = this.oldestRecordTs(records);
    let resetAt = now + WINDOW_MS;
    if (oldest !== undefined) resetAt = oldest + WINDOW_MS;

    // Check council limit first
    if (isCouncil && councilUsed >= MAX_COUNCIL_MESSAGES) {
      const councilTs = this.oldestRecordTs(records.filter((record) => record.type === 'council')) ?? now;
      const retryAfterMs = Math.max(0, councilTs + WINDOW_MS - now);

      return {
        allowed: false,
        estimatedTokens,
        tokensUsed,
        tokensLimit: MAX_LLM_TOKENS,
        tokensRemaining,
        councilUsed,
        councilLimit: MAX_COUNCIL_MESSAGES,
        councilRemaining,
        resetAt,
        retryAfter: Math.ceil(retryAfterMs / 1000),
        message: formatCouncilLimitMessage(retryAfterMs),
      };
    }

    // Check token limit
    if (tokensUsed + estimatedTokens > MAX_LLM_TOKENS) {
      // Find when enough of the window will have expired for this estimate.
      let remaining = tokensUsed;
      let nextAvailable = oldest !== undefined ? oldest + WINDOW_MS : now;
      for (const record of [...records].sort((a, b) => a.timestamp - b.timestamp)) {
        remaining -= record.tokens;
        if (MAX_LLM_TOKENS - remaining >= estimatedTokens) {
          nextAvailable = record.timestamp + WINDOW_MS;
          break;
        }
      }
      const retryAfterMs = Math.max(0, nextAvailable - now);

      return {
        allowed: false,
        estimatedTokens,
        tokensUsed,
        tokensLimit: MAX_LLM_TOKENS,
        tokensRemaining,
        councilUsed,
        councilLimit: MAX_COUNCIL_MESSAGES,
        councilRemaining,
        resetAt,
        retryAfter: Math.ceil(retryAfterMs / 1000),
        message: formatTokenLimitMessage(retryAfterMs, estimatedTokens, tokensRemaining),
      };
    }

    return {
      allowed: true,
      estimatedTokens,
      tokensUsed,
      tokensLimit: MAX_LLM_TOKENS,
      tokensRemaining: tokensRemaining - estimatedTokens,
      councilUsed,
      councilLimit: MAX_COUNCIL_MESSAGES,
      councilRemaining: isCouncil ? councilRemaining - 1 : councilRemaining,
      resetAt,
    };
  }
}

// Fallback singleton (development/test only)
const memoryLimiter = new MemoryTokenLimiter();

let warnedAboutFallback = false;
function fallBackToMemoryLimiter(operation: string): void {
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      `⚠️  Redis is unavailable - LLM rate limiting falls back to per-instance in-memory counters (${operation}). This is only acceptable in development/test; production fails closed with a 503.`
    );
  }
}

function unavailableResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'Rate limiter unavailable',
      message: 'The rate limiting backend is temporarily unavailable. Please retry shortly.',
    }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
    }
  );
}

/**
 * Calculate LLM tokens in a message (input + typical output). Callers pass
 * the full prompt text (history + message + attachment text) so the check
 * estimates what the model call will actually cost; the difference against
 * the real usage is corrected by recordLLMTokens.
 */
export function estimatePromptTokens(promptText: string, isCouncil: boolean): number {
  // Count input tokens
  const inputTokens = encode(promptText).length;

  // Estimate output tokens (typically 2-3x input for good responses)
  // Council mode generates longer responses
  const outputMultiplier = isCouncil ? 4 : 2.5;
  const estimatedOutputTokens = Math.ceil(inputTokens * outputMultiplier);

  return inputTokens + estimatedOutputTokens;
}

/**
 * Record actual tokens used after message completion. Reconciles the
 * reservation taken by withLLMTokenLimit (estimate -> actual).
 */
export async function recordLLMTokens(
  userId: string,
  actualTokens: number,
  isCouncil: boolean
): Promise<void> {
  try {
    await runLimiterScript('reconcile', userId, actualTokens, isCouncil, randomUUID());
    return;
  } catch (error) {
    if (isProduction()) {
      // The call already happened; dropping the usage would open a bypass.
      console.error('Failed to record LLM tokens in Redis:', error instanceof Error ? error.message : error);
      throw error;
    }
    fallBackToMemoryLimiter('recordLLMTokens');
  }
  memoryLimiter.record(userId, actualTokens, isCouncil);
}

/**
 * Get user's current rate limit status
 */
export async function getLLMTokenStatus(userId: string): Promise<{
  tokensUsed: number;
  tokensLimit: number;
  tokensRemaining: number;
  councilUsed: number;
  councilLimit: number;
  councilRemaining: number;
  resetAt: number;
  canSendRegular: boolean;
  canSendCouncil: boolean;
}> {
  const now = Date.now();
  try {
    const [, used, councilUsed, oldestTs] = await runLimiterScript('status', userId, 0, false, '');
    return buildStatus(now, used, councilUsed, oldestTs >= 0 ? oldestTs : undefined);
  } catch (error) {
    if (isProduction()) throw error;
    fallBackToMemoryLimiter('getLLMTokenStatus');
  }
  return memoryLimiter.getStatus(userId);
}

function buildStatus(now: number, tokensUsed: number, councilUsed: number, oldestTs?: number) {
  const tokensRemaining = Math.max(0, MAX_LLM_TOKENS - tokensUsed);
  const councilRemaining = Math.max(0, MAX_COUNCIL_MESSAGES - councilUsed);
  const resetAt = oldestTs !== undefined ? oldestTs + WINDOW_MS : now + WINDOW_MS;

  // Estimate: can send regular if we have at least 100 tokens
  // (minimum for a basic message)
  const canSendRegular = tokensRemaining >= 100;
  const canSendCouncil = councilRemaining > 0 && tokensRemaining >= 500;

  return {
    tokensUsed,
    tokensLimit: MAX_LLM_TOKENS,
    tokensRemaining,
    councilUsed,
    councilLimit: MAX_COUNCIL_MESSAGES,
    councilRemaining,
    resetAt,
    canSendRegular,
    canSendCouncil,
  };
}

/**
 * Check if the user can send a message, and atomically reserve the estimated
 * cost until recordLLMTokens reconciles it (stopped and failed calls are
 * still reconciled by the caller, so the reservation is never free).
 */
async function checkAndReserveLLMTokenLimit(
  userId: string,
  promptText: string,
  isCouncil: boolean,
  estimatedTokensOverride?: number
): Promise<LimiterDecision> {
  const estimatedTokens = estimatedTokensOverride ?? estimatePromptTokens(promptText, isCouncil);
  const now = Date.now();

  try {
    const [allowed, used, councilUsed, reasonCode, retryAtTs, oldestTs] = await runLimiterScript(
      'reserve',
      userId,
      estimatedTokens,
      isCouncil,
      randomUUID()
    );

    const tokensRemaining = Math.max(0, MAX_LLM_TOKENS - used);
    const councilRemaining = Math.max(0, MAX_COUNCIL_MESSAGES - councilUsed);
    const base: LimiterDecision = {
      allowed: allowed === 1,
      estimatedTokens,
      tokensUsed: used,
      tokensLimit: MAX_LLM_TOKENS,
      tokensRemaining: allowed === 1 ? Math.max(0, tokensRemaining - estimatedTokens) : tokensRemaining,
      councilUsed,
      councilLimit: MAX_COUNCIL_MESSAGES,
      councilRemaining: allowed === 1 && isCouncil ? Math.max(0, councilRemaining - 1) : councilRemaining,
      resetAt: oldestTs >= 0 ? oldestTs + WINDOW_MS : now + WINDOW_MS,
    };

    if (base.allowed) return base;

    const retryAfterMs = Math.max(0, retryAtTs - now);
    return {
      ...base,
      retryAfter: Math.ceil(retryAfterMs / 1000),
      message:
        reasonCode === 2
          ? formatCouncilLimitMessage(retryAfterMs)
          : formatTokenLimitMessage(retryAfterMs, estimatedTokens, tokensRemaining),
    };
  } catch (error) {
    if (isProduction()) throw error;
    fallBackToMemoryLimiter(`withLLMTokenLimit(${error instanceof Error ? error.message : 'redis error'})`);
  }
  return memoryLimiter.reserve(userId, estimatedTokens, isCouncil);
}

/**
 * Middleware for chat routes. Reserves the estimate when allowed; the caller
 * must reconcile with recordLLMTokens after the model call.
 *
 * `estimatedTokens` lets a caller that already measured the rendered request
 * (including a compaction call) reserve exactly that amount instead of
 * re-estimating from text.
 */
export async function withLLMTokenLimit(
  userId: string,
  promptText: string,
  isCouncil: boolean,
  estimatedTokens?: number
): Promise<Response | null> {
  let result: LimiterDecision;
  try {
    result = await checkAndReserveLLMTokenLimit(userId, promptText, isCouncil, estimatedTokens);
  } catch {
    return unavailableResponse(); // Fail closed: no limiter, no paid calls.
  }

  if (!result.allowed) {
    const resetDate = new Date(result.resetAt);

    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: result.message,
        details: {
          estimatedTokens: result.estimatedTokens,
          tokensUsed: result.tokensUsed,
          tokensLimit: result.tokensLimit,
          tokensRemaining: result.tokensRemaining,
          councilUsed: result.councilUsed,
          councilLimit: result.councilLimit,
          councilRemaining: result.councilRemaining,
          resetAt: result.resetAt,
          resetTime: resetDate.toISOString(),
          retryAfter: result.retryAfter,
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-LLM-Tokens-Limit': result.tokensLimit.toString(),
          'X-RateLimit-LLM-Tokens-Remaining': result.tokensRemaining.toString(),
          'X-RateLimit-Council-Limit': result.councilLimit.toString(),
          'X-RateLimit-Council-Remaining': result.councilRemaining.toString(),
          'X-RateLimit-Reset': result.resetAt.toString(),
          'Retry-After': (result.retryAfter || 0).toString(),
          // Which of the two limits tripped (the council cap or the token cap).
          'X-RateLimit-Limit-Type': isCouncil && result.councilUsed >= result.councilLimit ? 'council' : 'tokens',
        },
      }
    );
  }

  return null; // Success - continue (estimate reserved)
}

/**
 * Format user-friendly retry message for token limit
 */
function formatTokenLimitMessage(
  retryAfterMs: number,
  tokensNeeded: number,
  tokensRemaining: number
): string {
  const hours = Math.floor(retryAfterMs / (60 * 60 * 1000));
  const minutes = Math.floor((retryAfterMs % (60 * 60 * 1000)) / (60 * 1000));

  let timeStr = '';
  if (hours > 0) {
    timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) {
      timeStr += ` and ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  } else if (minutes > 0) {
    timeStr = `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    timeStr = 'a few seconds';
  }

  return `You've used your daily token limit. This message needs ~${tokensNeeded} tokens but you only have ${tokensRemaining} remaining. More tokens available in ${timeStr}.`;
}

/**
 * Format user-friendly retry message for council limit
 */
function formatCouncilLimitMessage(retryAfterMs: number): string {
  const hours = Math.floor(retryAfterMs / (60 * 60 * 1000));
  const minutes = Math.floor((retryAfterMs % (60 * 60 * 1000)) / (60 * 1000));

  let timeStr = '';
  if (hours > 0) {
    timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) {
      timeStr += ` and ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  } else if (minutes > 0) {
    timeStr = `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    timeStr = 'a few seconds';
  }

  return `You've reached your daily limit of 2 council messages. You can send another council message in ${timeStr}.`;
}

/**
 * Count tokens in text (for calculating actual usage)
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/** @internal test hook */
export function __resetMemoryLimiterForTests(): void {
  memoryLimiter.reset();
  warnedAboutFallback = false;
}
