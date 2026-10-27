import { z } from 'zod';
import { addCatalogSkill } from '@/src/lib/server/skills';
import { sessionUserId, skillErrorResponse, unauthorized } from '@/src/lib/server/skill-routes';

/** Adds a Discover skill to the user's skills (or returns the copy they have). */
export async function POST(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = z.object({ id: z.string().min(1).max(100) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });
  try {
    return Response.json({ skill: await addCatalogSkill(userId, parsed.data.id) });
  } catch (error) {
    return skillErrorResponse(error);
  }
}
