/**
 * Short-lived store for pending tool approvals. The chat request that asked for
 * approval waits here while a separate HTTP request delivers the user's decision,
 * which is why the pending record lives in Redis when it is configured: any
 * server instance has to be able to receive the answer. Without Redis the same
 * API falls back to process memory, which is what the tests and a single-instance
 * deployment use.
 *
 * A pending approval is consumed by exactly one decision: the record is deleted
 * atomically, so a replayed or double-clicked decision finds nothing and a second
 * user cannot spend it. Records expire on a TTL as well as a stored timestamp.
 */
import { randomUUID } from 'node:crypto';
import { redisStore } from '@/src/lib/redis';
import { mcpApprovalTtlSeconds } from '@/src/lib/api/chat/mcp-config';

export type ApprovalDecision = 'approved' | 'denied';

export interface PendingApproval {
  id: string;
  userId: string;
  conversationId: string;
  callId: string;
  connectionId: string;
  toolId: string;
  name: string;
  arguments: Record<string, unknown>;
  round: number;
  createdAt: number;
  expiresAt: number;
}

export const APPROVAL_TTL_SECONDS = 120;
const DECISION_TTL_SECONDS = 300;
const POLL_MS = 150;

export type DecisionOutcome = 'recorded' | 'not_found' | 'expired' | 'forbidden';

const pendingKey = (id: string) => `mcp:approval:${id}`;
const decisionKey = (id: string) => `mcp:decision:${id}`;

const memory = new Map<string, { value: string; expiresAt: number }>();

const readMemory = (key: string): string | null => {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
};

const writeMemory = (key: string, value: string, ttlSeconds: number) => {
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
};

/** Redis when it is reachable, process memory otherwise - never both at once. */
const redisBacked = () => redisStore.isReady();

async function take(key: string): Promise<string | null> {
  if (redisBacked()) {
    try {
      const value = await redisStore.evalScript(
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
        { keys: [key], arguments: [] }
      );
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  const value = readMemory(key);
  if (value) memory.delete(key);
  return value;
}

async function put(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (redisBacked()) {
    await redisStore.setKey(key, value, ttlSeconds).catch(() => {});
    return;
  }
  writeMemory(key, value, ttlSeconds);
}

async function peek(key: string): Promise<string | null> {
  if (redisBacked()) return await redisStore.getKey(key).catch(() => null);
  return readMemory(key);
}

async function drop(key: string): Promise<void> {
  memory.delete(key);
  if (redisBacked()) await redisStore.deleteKey(key).catch(() => {});
}

const parse = (raw: string | null): PendingApproval | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingApproval;
    if (typeof value?.id !== 'string' || typeof value.userId !== 'string') return null;
    if (value.expiresAt <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
};

export async function createApproval(
  input: Omit<PendingApproval, 'id' | 'createdAt' | 'expiresAt'>,
  ttlSeconds = mcpApprovalTtlSeconds()
): Promise<PendingApproval> {
  const approval: PendingApproval = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  await put(pendingKey(approval.id), JSON.stringify(approval), ttlSeconds);
  return approval;
}

export async function getApproval(id: string): Promise<PendingApproval | null> {
  return parse(await peek(pendingKey(id)));
}

/**
 * Records the user's answer for their own pending call. The pending record is
 * consumed, so the same `approvalId` can never be decided twice.
 */
export async function submitDecision(input: { id: string; userId: string; conversationId?: string; decision: ApprovalDecision }): Promise<DecisionOutcome> {
  const current = await getApproval(input.id);
  if (!current) return (await peek(pendingKey(input.id))) ? 'expired' : 'not_found';
  if (current.userId !== input.userId) return 'forbidden';
  if (input.conversationId && current.conversationId !== input.conversationId) return 'forbidden';
  const consumed = await take(pendingKey(input.id));
  if (!consumed) return 'not_found';
  await put(decisionKey(input.id), input.decision, DECISION_TTL_SECONDS);
  return 'recorded';
}

/** The decision once someone has made one; null while it is still pending. */
export async function collectDecision(id: string): Promise<ApprovalDecision | null> {
  const value = await take(decisionKey(id));
  return value === 'approved' || value === 'denied' ? value : null;
}

/** Drops a pending request, e.g. when the user stops the turn. */
export async function cancelApproval(id: string): Promise<void> {
  await drop(pendingKey(id));
  await drop(decisionKey(id));
}

export type WaitOutcome = ApprovalDecision | 'expired' | 'cancelled';

/**
 * Waits for the user's answer on behalf of the chat turn. Returns `expired` when
 * the request timed out and `cancelled` when the browser went away.
 */
export async function waitForDecision(
  approval: PendingApproval,
  options: { signal: AbortSignal; timeoutMs?: number; pollMs?: number }
): Promise<WaitOutcome> {
  // Never wait past the stored expiry: the record is undecidable after that.
  const deadline = Math.min(
    options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : approval.expiresAt,
    approval.expiresAt
  );
  while (Date.now() < deadline) {
    if (options.signal.aborted) {
      await cancelApproval(approval.id);
      return 'cancelled';
    }
    const decision = await collectDecision(approval.id);
    if (decision) return decision;
    const stillPending = await getApproval(approval.id);
    if (!stillPending) return 'expired';
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? POLL_MS));
  }
  await cancelApproval(approval.id);
  return 'expired';
}

/** Test helper: forget everything, so cases stay independent. */
export function clearApprovalStore(): void {
  memory.clear();
}
