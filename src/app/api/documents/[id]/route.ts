import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { documentMeta, removeDocument } from '@/src/lib/server/documents';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json();
  if (typeof body.favorite !== 'boolean') return Response.json({ error: 'Invalid request' }, { status: 400 });
  const updated = await prisma.document.updateMany({
    where: { id, userId: session.user.id },
    data: { favoritedAt: body.favorite ? new Date() : null },
  });
  if (!updated.count) return Response.json({ error: 'Document not found' }, { status: 404 });
  const document = await prisma.document.findUniqueOrThrow({ where: { id } });
  return Response.json({ document: documentMeta(document) });
}

export async function DELETE(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const removed = await removeDocument(session.user.id, id);
  return removed ? new Response(null, { status: 204 }) : Response.json({ error: 'Document not found' }, { status: 404 });
}
