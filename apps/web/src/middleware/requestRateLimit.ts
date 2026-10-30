// src/middleware/requestRateLimit.ts
// Generic per-user request caps for expensive API routes (RAG, profile).
//
// Reuses the Redis connection from src/lib/redis.ts: one fixed-window
// counter per user and limit, bumped atomically with INCR + first-write
// PEXPIRE inside a Lua script, so concurrent requests cannot both slip
// past the cap. Production fails closed with a 503 when Redis is
// unavailable; development/test fall back to in-process counters with a
// console warning.

import { redisStore } from '@/src/lib/redis';

export interface RouteLimit {
  /** Namespace for the Redis key, e.g. 'rag-ingest'. */
  name: string;
  max: number;
  windowMs: number;
}

export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** Per-user caps for the paid RAG/profile endpoints. */
export const RAG_INGEST_LIMITS: RouteLimit[] = [
  { name: 'rag-ingest', max: 30, windowMs: MINUTE_MS },
  { name: 'rag-ingest-daily', max: 500, windowMs: DAY_MS },
];
export const RAG_RETRIEVE_LIMITS: RouteLimit[] = [
  { name: 'rag-retrieve', max: 30, windowMs: MINUTE_MS },
  { name: 'rag-retrieve-daily', max: 500, windowMs: DAY_MS },
];
export const PROFILE_REFRESH_LIMITS: RouteLimit[] = [
  { name: 'profile-refresh', max: 5, windowMs: MINUTE_MS },
  { name: 'profile-refresh-daily', max: 50, windowMs: DAY_MS },
];

// INCR, and set the TTL only when this request created the bucket. The
// bucket id embeds the window, so retry timing needs no extra round trip.
const BUMP_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function bucketId(windowMs: number): number {
  return Math.floor(Date.now() / windowMs);
}

function redisKey(limit: RouteLimit, userId: string): string {
  return `ratelimit:api:${limit.name}:${limit.windowMs}:${userId}:${bucketId(limit.windowMs)}`;
}

/** Dev/test fallback when Redis is unavailable: in-process counters. */
const memoryCounters = new Map<string, { count: number; resetAt: number }>();

function memoryBump(limit: RouteLimit, userId: string): { count: number; retryAfterMs: number } {
  const now = Date.now();
  const key = `${limit.name}:${userId}`;
  const entry = memoryCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + limit.windowMs };
    memoryCounters.set(key, fresh);
    return { count: fresh.count, retryAfterMs: limit.windowMs };
  }
  entry.count += 1;
  return { count: entry.count, retryAfterMs: Math.max(0, entry.resetAt - now) };
}

let warnedAboutFallback = false;
function fallBackToMemoryCounter(): void {
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '⚠️  Redis is unavailable - API request rate limits fall back to per-instance in-memory counters. This is only acceptable in development/test; production fails closed with a 503.'
    );
  }
}

/**
 * Bumps the counter for one limit and answers whether the request may
 * proceed. retryAfterMs is meaningful only when denied.
 */
async function bumpLimit(limit: RouteLimit, userId: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const start = bucketId(limit.windowMs) * limit.windowMs;
  try {
    const reply = await redisStore.evalScript(BUMP_SCRIPT, {
      keys: [redisKey(limit, userId)],
      arguments: [limit.windowMs],
    });
    const count = Number(Array.isArray(reply) ? reply[0] : reply);
    if (!Number.isFinite(count)) throw new Error(`Unexpected limiter reply: ${JSON.stringify(reply)}`);
    return { allowed: count <= limit.max, retryAfterMs: start + limit.windowMs - Date.now() };
  } catch (error) {
    if (isProduction()) throw error;
    fallBackToMemoryCounter();
  }
  const memory = memoryBump(limit, userId);
  return { allowed: memory.count <= limit.max, retryAfterMs: memory.retryAfterMs };
}

function tooManyRequests(limit: RouteLimit, retryAfterMs: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const windowLabel = limit.windowMs >= DAY_MS ? 'day' : limit.windowMs >= MINUTE_MS ? 'minute' : `${Math.round(limit.windowMs / 1000)} seconds`;
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message: `Too many requests. This endpoint allows ${limit.max} requests per ${windowLabel}. Try again in ~${retryAfterSeconds}s.`,
      retryAfter: retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Limit': String(limit.max),
        'X-RateLimit-Window-Ms': String(limit.windowMs),
      },
    }
  );
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
 * Guard an expensive route: returns null when every limit has room (and has
 * counted this request), otherwise a ready-to-return 429 with Retry-After.
 * Fails closed (503) in production when Redis cannot be reached.
 */
export async function withUserRateLimits(userId: string, limits: RouteLimit[]): Promise<Response | null> {
  for (const limit of limits) {
    let decision: { allowed: boolean; retryAfterMs: number };
    try {
      decision = await bumpLimit(limit, userId);
    } catch {
      return unavailableResponse();
    }
    if (!decision.allowed) return tooManyRequests(limit, decision.retryAfterMs);
  }
  return null;
}

/** @internal test hook */
export function __resetRequestLimitCountersForTests(): void {
  memoryCounters.clear();
  warnedAboutFallback = false;
}
