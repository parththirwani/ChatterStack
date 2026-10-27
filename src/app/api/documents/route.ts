import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { confirmUpload, documentMeta, MAX_FILE_SIZE } from '@/src/lib/server/documents';
import { fileMimeType } from '@/src/lib/api/chat/attachments';
import { captureError } from '@/src/lib/observability/capture';

const uploadSchema = z.object({
  name: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().min(1).max(MAX_FILE_SIZE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageKey: z.string().min(1).max(500),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const documents = await prisma.document.findMany({
    where: { userId: session.user.id },
    orderBy: [{ favoritedAt: 'desc' }, { createdAt: 'desc' }],
  });
  return Response.json({ documents: documents.map(documentMeta) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = uploadSchema.safeParse(await request.json());
  if (!parsed.success || fileMimeType(parsed.data.name) !== parsed.data.mimeType) {
    return Response.json({ error: 'Invalid file details' }, { status: 400 });
  }
  try {
    const document = await confirmUpload(session.user.id, parsed.data);
    return Response.json({ document: documentMeta(document) }, { status: 201 });
  } catch (error) {
    captureError(error, { route: '/api/documents', userId: session.user.id, stage: 'confirm-upload' });
    return Response.json({ error: error instanceof Error ? error.message : 'Could not save document' }, { status: 400 });
  }
}
