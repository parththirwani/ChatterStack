/**
 * Number legacy messages after `npx prisma db push`:
 *
 *   node scripts/backfill-message-positions.mjs
 *
 * Existing positions define the order of new chats and forks. Null positions
 * sort first, with their old createdAt/id order. A table lock and one transaction
 * keep readers from ever seeing a partly renumbered conversation.
 */
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE messages IN SHARE ROW EXCLUSIVE MODE');
  const { rows: [{ missing }] } = await client.query(
    'SELECT count(*)::int AS missing FROM messages WHERE position IS NULL OR position < 0'
  );

  if (missing > 0) {
    // Record the current display order before clearing positions. Clearing to
    // NULL avoids transient unique-key collisions while we assign 1..n.
    await client.query(`
      CREATE TEMP TABLE message_position_rank ON COMMIT DROP AS
      SELECT id, row_number() OVER (
        PARTITION BY "conversationId"
        ORDER BY position ASC NULLS FIRST, "createdAt" ASC, id ASC
      )::int AS new_position
      FROM messages
    `);
    await client.query('UPDATE messages SET position = NULL');
    await client.query(`
      UPDATE messages m
      SET position = ranked.new_position
      FROM message_position_rank ranked
      WHERE m.id = ranked.id
    `);
  }

  await client.query('COMMIT');
  console.log(`Message positions: ${missing} legacy row(s) found; backfill complete.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
