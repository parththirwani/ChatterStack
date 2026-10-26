import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { documentStorage } from '@/src/lib/server/document-storage';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const document = await prisma.document.findFirst({ where: { id, userId: session.user.id } });
  if (!document) return Response.json({ error: 'Document not found' }, { status: 404 });
  const result = await documentStorage.stream(document.storageKey);
  if (!result || result.statusCode !== 200) return Response.json({ error: 'Content not found' }, { status: 404 });
  return new Response(result.stream, {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Length': String(document.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
