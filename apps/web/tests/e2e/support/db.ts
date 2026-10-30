/**
 * Talks to the app's Postgres through `docker exec psql`, so the tests need
 * no database driver or credentials of their own.
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.E2E_PG_CONTAINER ?? 'chatterstack-postgres-1';
const DB_USER = process.env.E2E_PG_USER ?? 'chatterstack';
const DB_NAME = process.env.E2E_PG_DB ?? 'chatterstack';

export const E2E_USER_ID = 'e2e-test-user';
export const E2E_SESSION_TOKEN = 'e2e-test-session-token';

export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query],
    { encoding: 'utf8' }
  ).trim();
}

export const literal = (value: string | null) => (value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`);

/** Writes (or restores, after a test signs out) the test user's database session. */
export function seedSession() {
  sql(`INSERT INTO sessions (id, "sessionToken", "userId", expires)
       VALUES ('e2e-test-session', ${literal(E2E_SESSION_TOKEN)}, ${literal(E2E_USER_ID)}, now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET "sessionToken" = EXCLUDED."sessionToken", expires = EXCLUDED.expires`);
}

export function deleteTestConversations() {
  sql(`DELETE FROM conversations WHERE "userId" = ${literal(E2E_USER_ID)}`);
}

interface SeedConversation {
  id: string;
  title: string | null;
  /** Minutes ago. */
  updated: number;
  pinned?: number;
  messages?: Array<{ role: 'user' | 'assistant'; content: string; modelId?: string }>;
}

export function seedConversation({ id, title, updated, pinned, messages = [] }: SeedConversation) {
  const at = (minutes: number) => `now() - interval '${minutes} minutes'`;
  sql(`INSERT INTO conversations (id, title, "userId", "pinnedAt", "createdAt", "updatedAt")
       VALUES (${literal(id)}, ${literal(title)}, ${literal(E2E_USER_ID)}, ${pinned === undefined ? 'NULL' : at(pinned)}, ${at(updated)}, ${at(updated)})`);
  messages.forEach((message, index) => {
    sql(`INSERT INTO messages (id, "conversationId", content, role, "modelId", position, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), ${literal(id)}, ${literal(message.content)}, ${literal(message.role)}, ${literal(message.modelId ?? null)}, ${index + 1},
                 ${at(updated)} + interval '${index} seconds', now())`);
  });
}

export function conversationRow(id: string): { title: string | null; pinned: boolean } | null {
  const out = sql(`SELECT coalesce(title, ''), "pinnedAt" IS NOT NULL FROM conversations WHERE id = ${literal(id)}`);
  if (!out) return null;
  const [title, pinned] = out.split('|');
  return { title: title || null, pinned: pinned === 't' };
}

/** How many messages a chat has saved. */
export function messageCount(conversationId: string): number {
  return Number(sql(`SELECT count(*) FROM messages WHERE "conversationId" = ${literal(conversationId)}`));
}

/** The chat's saved rows, in the order the app reads them. */
export function savedMessages(conversationId: string): Array<{ id: string; role: string; content: string; position: number }> {
  const out = sql(`SELECT id, role, content, position FROM messages WHERE "conversationId" = ${literal(conversationId)}`
    + ` ORDER BY position NULLS FIRST, "createdAt", id`);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [id, role, content, position] = line.split('|');
    return { id, role, content, position: Number(position) };
  });
}

/** Chats forked from this one, newest first, with the message each was cut at. */
export function forksOf(conversationId: string): Array<{ id: string; title: string | null; forkedFromMessageId: string }> {
  const out = sql(`SELECT id, coalesce(title, ''), "forkedFromMessageId" FROM conversations WHERE "parentConversationId" = ${literal(conversationId)}`
    + ` ORDER BY "createdAt" DESC`);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [id, title, forkedFromMessageId] = line.split('|');
    return { id, title: title || null, forkedFromMessageId };
  });
}
