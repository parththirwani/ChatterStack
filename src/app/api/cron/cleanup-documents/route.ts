import { cleanupUnconfirmedUploads, cleanupUnusedDocuments } from '@/src/lib/server/documents';
import { captureError } from '@/src/lib/observability/capture';

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const removed = await cleanupUnusedDocuments();
    const orphaned = await cleanupUnconfirmedUploads();
    return Response.json({ removed, orphaned });
  } catch (error) {
    captureError(error, { route: '/api/cron/cleanup-documents', stage: 'cleanup' });
    throw error;
  }
}
