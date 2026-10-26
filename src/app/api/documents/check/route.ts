import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { prisma } from '@/src/lib/prisma';
import { documentMeta } from '@/src/lib/server/documents';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'Invalid hash' }, { status: 400 });
  const document = await prisma.document.findUnique({
    where: { userId_sha256: { userId: session.user.id, sha256: parsed.data.sha256 } },
  });
  return Response.json({ document: document ? documentMeta(document) : null });
}
