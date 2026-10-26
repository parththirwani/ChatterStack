import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { documentStorage } from '@/src/lib/server/document-storage';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const document = await prisma.document.findFirst({ where: { id, userId: session.user.id } });
  if (!document) return Response.json({ error: 'Document not found' }, { status: 404 });
  const preview = new URL(request.url).searchParams.get('preview') === '1';
  if (preview && document.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const bytes = await documentStorage.read(document.storageKey);
    if (!bytes) return Response.json({ error: 'Content not found' }, { status: 404 });
    try {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      return new Response(value, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return Response.json({ error: 'Could not preview document' }, { status: 422 });
    }
  }
  const result = await documentStorage.stream(document.storageKey);
  if (!result || result.statusCode !== 200) return Response.json({ error: 'Content not found' }, { status: 404 });
  return new Response(result.stream, {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Length': String(document.size),
      'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
