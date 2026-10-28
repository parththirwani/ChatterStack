import type { Prisma } from '@prisma/client';

/**
 * A question and its answer are saved together, so `createdAt` can tie and is
 * only roughly chronological. `position` (1-based inside a conversation) is the
 * order history, forks and the sidebar all read from.
 *
 * Rows saved before the column existed have no position. They sort first, by
 * time, which keeps them ahead of anything appended after the column landed.
 */
export const MESSAGE_ORDER: Prisma.MessageOrderByWithRelationInput[] = [
  { position: { sort: 'asc', nulls: 'first' } },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/** Same order, newest message first. */
export const MESSAGE_ORDER_DESC: Prisma.MessageOrderByWithRelationInput[] = [
  { position: { sort: 'desc', nulls: 'last' } },
  { createdAt: 'desc' },
  { id: 'desc' },
];

/**
 * Position for the next message appended to a conversation. Rows that predate
 * the column have no position, so the row count is the other lower bound: the
 * new row must land behind the unpositioned ones as well as behind everything
 * that already has a position.
 */
export function nextPosition(maxPosition: number | null | undefined, rowCount: number): number {
  return Math.max(maxPosition ?? 0, rowCount) + 1;
}
