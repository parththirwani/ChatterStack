import { prisma } from '@/src/lib/prisma';
import { MESSAGE_ORDER } from '@/src/lib/server/message-order';
import { getConversation } from '@/src/lib/server/conversations';
import { Role } from '@/src/types/chat.types';
import type { Conversation } from '@/src/types/conversation.types';
import type { Prisma } from '@prisma/client';

/** Same ceiling the rename route uses. */
const TITLE_MAX_LENGTH = 80;
const FORK_PREFIX = 'Fork of ';
const UNTITLED = 'untitled chat';

/** Raised when the chosen message isn't in the snapshot the fork copies. */
export class ForkTargetGone extends Error {}

/** `Fork of <source title>`, or of its first question when the source has no title. */
export function forkTitle(sourceTitle: string | null | undefined, firstQuestion?: string | null): string {
  const base = sourceTitle?.trim() || firstQuestion?.trim().replace(/\s+/g, ' ') || UNTITLED;
  return `${FORK_PREFIX}${base}`.slice(0, TITLE_MAX_LENGTH);
}

export type ForkResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; reason: 'not-found' };

/**
 * Copy a chat's messages up to and including one message into a new chat.
 *
 * The read and both inserts share one transaction, so a failure never leaves an
 * empty fork behind, and the snapshot excludes anything the source saves later
 * (an answer that is still streaming, for instance). Redis is deliberately not
 * written: the fork's first send loads its own copied rows from Postgres, so it
 * can't inherit messages from after the chosen point.
 */
export async function forkConversationAtMessage(
  userId: string,
  conversationId: string,
  messageId: string
): Promise<ForkResult> {
  // Scheduled task runs are listed and managed on their own page, so they stay
  // out of forking for now.
  const source = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, scheduledTaskId: null },
    select: { id: true, title: true },
  });
  if (!source) return { ok: false, reason: 'not-found' };

  // The message has to belong to that chat: another chat's id is a miss, not a fork.
  const selected = await prisma.message.findFirst({
    where: { id: messageId, conversationId: source.id },
    select: { id: true },
  });
  if (!selected) return { ok: false, reason: 'not-found' };

  const forkedId = await prisma.$transaction(async (tx) => {
    const rows = await tx.message.findMany({
      where: { conversationId: source.id },
      orderBy: MESSAGE_ORDER,
    });
    const cut = rows.findIndex((row) => row.id === selected.id);
    if (cut === -1) throw new ForkTargetGone();
    const prefix = rows.slice(0, cut + 1);

    // `updatedAt` stays "now": a fork is new activity and lands on top of Recents.
    const created = await tx.conversation.create({
      data: {
        userId,
        title: forkTitle(source.title, prefix.find((row) => row.role === Role.User)?.content),
        parentConversationId: source.id,
        forkedFromMessageId: selected.id,
      },
      select: { id: true },
    });

    await tx.message.createMany({
      data: prefix.map((row, index) => ({
        conversationId: created.id,
        content: row.content,
        role: row.role,
        modelId: row.modelId,
        // Positions are renumbered from 1 so the copy is dense and its next
        // exchange continues after the last copied row.
        position: index + 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...(row.attachments === null || row.attachments === undefined
          ? {}
          : { attachments: row.attachments as Prisma.InputJsonValue }),
        ...(row.skills === null || row.skills === undefined
          ? {}
          : { skills: row.skills as Prisma.InputJsonValue }),
      })),
    });

    return created.id;
  });

  const conversation = await getConversation(userId, forkedId);
  if (!conversation) return { ok: false, reason: 'not-found' };
  return { ok: true, conversation };
}
