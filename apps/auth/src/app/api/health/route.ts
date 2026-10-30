import { prisma } from '@/src/lib/prisma';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ service: 'auth', status: 'ok' });
  } catch {
    return Response.json({ service: 'auth', status: 'unavailable' }, { status: 503 });
  }
}
