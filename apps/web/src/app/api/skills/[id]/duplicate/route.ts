import { duplicateSkill } from '@/src/lib/server/skills';
import { notFound, sessionUserId, skillErrorResponse, unauthorized } from '@/src/lib/server/skill-routes';

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  try {
    const skill = await duplicateSkill(userId, (await context.params).id);
    return skill ? Response.json({ skill }, { status: 201 }) : notFound();
  } catch (error) {
    return skillErrorResponse(error);
  }
}
