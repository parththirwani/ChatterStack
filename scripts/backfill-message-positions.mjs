/**
 * One-time, resumable backfill of `messages.position` for rows saved before the
 * column existed. Run it after `npx prisma db push`, while traffic is low:
 *
 *   node scripts/backfill-message-positions.mjs
 *
 * Every row of every conversation is renumbered 1..n by (createdAt, id), the only
 * order history old rows carry. Whole conversations are renumbered rather than
 * just the rows with no position, so a chat written partly before and partly
 * after the column landed ends up in the right order.
 *
 * Two passes because (conversationId, position) is unique and renumbering in
 * place would briefly put two rows on the same number. The first pass moves every
 * row out of the way into negative numbers, which cannot collide with anything
 * that is still to be written; the second flips them into place. Running it twice
 * changes nothing the second time around.
 */
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const RENUMBER = `
  WITH ranked AS (
    SELECT id, row_number() OVER (
      PARTITION BY "conversationId" ORDER BY "createdAt", id
    ) AS n
    FROM messages
  )
  UPDATE messages m
  SET position = -ranked.n
  FROM ranked
  WHERE m.id = ranked.id
`;

const FLIP = `UPDATE messages SET position = -position WHERE position < 0`;

try {
  const before = await pool.query('SELECT count(*)::int AS missing FROM messages WHERE position IS NULL');
  const renumbered = await pool.query(RENUMBER);
  const placed = await pool.query(FLIP);
  const left = await pool.query('SELECT count(*)::int AS pending FROM messages WHERE position IS NULL OR position < 0');

  console.log(`Message positions: ${before.rows[0].missing} row(s) had none, ${renumbered.rowCount} moved, ${placed.rowCount} placed.`);
  if (left.rows[0].pending > 0) {
    console.warn(`Warning: ${left.rows[0].pending} row(s) are still unplaced (a write raced this run). Please run the script again.`);
  }
} finally {
  await pool.end();
}
