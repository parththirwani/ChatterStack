import crypto from 'crypto';
import { prisma } from '@/src/lib/prisma';

export interface ContextSnapshot {
  id: string;
  conversationId: string;
  summaryText: string;
  throughMessageId: string;
  sourceHash: string;
  version: number;
  schemaVersion: number;
  summaryModelId: string;
  inputTokensBefore: number;
  inputTokensAfter: number;
  summaryTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommitSnapshotInput {
  conversationId: string;
  summaryText: string;
  throughMessageId: string;
  sourceHash: string;
  summaryModelId: string;
  inputTokensBefore: number;
  inputTokensAfter: number;
  summaryTokens: number;
  /** The version this summary was built from; null when there was no snapshot. */
  expectedVersion: number | null;
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

/** Stable hash of the exact messages a summary covers. */
export function hashContextSource(
  messages: ReadonlyArray<{ id?: string; role: string; content: string }>
): string {
  const hash = crypto.createHash('sha256');
  for (const message of messages) {
    hash.update(message.id ?? '');
    hash.update('\u0000');
    hash.update(message.role);
    hash.update('\u0000');
    hash.update(message.content);
    hash.update('\u0001');
  }
  return hash.digest('hex');
}

export async function loadContextSnapshot(conversationId: string): Promise<ContextSnapshot | null> {
  return prisma.conversationContextSnapshot.findUnique({ where: { conversationId } });
}

export async function deleteContextSnapshot(conversationId: string): Promise<void> {
  await prisma.conversationContextSnapshot.deleteMany({ where: { conversationId } });
}

/**
 * Compare-and-swap on the snapshot version. A concurrent turn that built its
 * summary from different history cannot overwrite a newer snapshot: its
 * update matches no row, and a competing create loses on the unique key.
 *
 * Returns the stored row, or null when another writer won.
 */
export async function commitContextSnapshot(input: CommitSnapshotInput): Promise<ContextSnapshot | null> {
  const existing = await prisma.conversationContextSnapshot.findUnique({
    where: { conversationId: input.conversationId },
  });

  if (existing) {
    if (input.expectedVersion === null || existing.version !== input.expectedVersion) return null;

    const { count } = await prisma.conversationContextSnapshot.updateMany({
      where: { conversationId: input.conversationId, version: existing.version },
      data: {
        summaryText: input.summaryText,
        throughMessageId: input.throughMessageId,
        sourceHash: input.sourceHash,
        version: existing.version + 1,
        schemaVersion: 1,
        summaryModelId: input.summaryModelId,
        inputTokensBefore: input.inputTokensBefore,
        inputTokensAfter: input.inputTokensAfter,
        summaryTokens: input.summaryTokens,
      },
    });
    if (count === 0) return null;

    return prisma.conversationContextSnapshot.findUnique({ where: { conversationId: input.conversationId } });
  }

  if (input.expectedVersion !== null) return null;

  try {
    return await prisma.conversationContextSnapshot.create({
      data: {
        conversationId: input.conversationId,
        summaryText: input.summaryText,
        throughMessageId: input.throughMessageId,
        sourceHash: input.sourceHash,
        version: 1,
        schemaVersion: 1,
        summaryModelId: input.summaryModelId,
        inputTokensBefore: input.inputTokensBefore,
        inputTokensAfter: input.inputTokensAfter,
        summaryTokens: input.summaryTokens,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/**
 * A retry can replace the exchange a snapshot was built from. When the
 * boundary is no longer part of the saved history, the snapshot is unusable.
 */
export async function dropSnapshotIfBoundaryMissing(
  conversationId: string,
  historyIds: readonly string[]
): Promise<ContextSnapshot | null> {
  const snapshot = await loadContextSnapshot(conversationId);
  if (!snapshot) return null;
  if (historyIds.includes(snapshot.throughMessageId)) return snapshot;

  await deleteContextSnapshot(conversationId);
  return null;
}

/** @internal test hook */
export const __snapshotStoreForTests = { isUniqueViolation };
