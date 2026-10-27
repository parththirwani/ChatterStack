import { cleanupUnconfirmedUploads, cleanupUnusedDocuments } from '@/src/lib/server/documents';
import { redisStore } from '@/src/lib/redis';
import { captureError } from '@/src/lib/observability/capture';
import { isCronRequest } from '@/src/lib/server/cron-auth';

/**
 * Bounded cleanup of the blob store: this run continues from the persisted
 * listing cursor (if any) and stores the next cursor when it did not reach
 * the end, so the daily cron converges without re-listing the whole store.
 */
const CURSOR_KEY = 'cron:cleanup-unconfirmed-uploads:cursor';
// Two days: survive a skipped run, then start over from a fresh listing.
const CURSOR_TTL_SECONDS = 48 * 60 * 60;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
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
  } catch (error) {
    captureError(error, { route: '/api/cron/cleanup-documents', stage: 'cleanup' });
    throw error;
  }
}
