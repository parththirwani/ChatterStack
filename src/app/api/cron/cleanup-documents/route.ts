import crypto from 'node:crypto';
import { cleanupUnconfirmedUploads, cleanupUnusedDocuments } from '@/src/lib/server/documents';
import { redisStore } from '@/src/lib/redis';

/**
 * Bounded cleanup of the blob store: this run continues from the persisted
 * listing cursor (if any) and stores the next cursor when it did not reach
 * the end, so the daily cron converges without re-listing the whole store.
 */
const CURSOR_KEY = 'cron:cleanup-unconfirmed-uploads:cursor';
// Two days: survive a skipped run, then start over from a fresh listing.
const CURSOR_TTL_SECONDS = 48 * 60 * 60;

/**
 * Compare the `Authorization: Bearer <CRON_SECRET>` header without leaking
 * the secret through timing. Both sides are hashed first so the fixed-size
 * comparison cannot fail on a length mismatch (timingSafeEqual throws then).
 */
function bearerTokenMatches(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length);
  const expectedDigest = crypto.createHash('sha256').update(secret).digest();
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || !bearerTokenMatches(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const removed = await cleanupUnusedDocuments();
  const resumeFrom = await redisStore.getKey(CURSOR_KEY);
  const uploads = await cleanupUnconfirmedUploads(new Date(), { cursor: resumeFrom });
  if (uploads.hasMore && uploads.cursor) {
    await redisStore.setKey(CURSOR_KEY, uploads.cursor, CURSOR_TTL_SECONDS);
  } else if (!uploads.hasMore) {
    // Full sweep done: next run starts at the top of the store again.
    await redisStore.deleteKey(CURSOR_KEY);
  }
  return Response.json({ removed, orphaned: uploads.removed, orphanedHasMore: uploads.hasMore });
}
