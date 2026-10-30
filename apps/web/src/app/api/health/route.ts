import { prisma } from '@/src/lib/prisma';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ service: 'backend', status: 'ok' });
  } catch {
    return Response.json({ service: 'backend', status: 'unavailable' }, { status: 503 });
  }
}
