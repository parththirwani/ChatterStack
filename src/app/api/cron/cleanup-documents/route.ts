import { cleanupUnconfirmedUploads, cleanupUnusedDocuments } from '@/src/lib/server/documents';

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const removed = await cleanupUnusedDocuments();
  const orphaned = await cleanupUnconfirmedUploads();
  return Response.json({ removed, orphaned });
}
