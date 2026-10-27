import { z } from 'zod';
import { deleteSkill, getSkill, updateSkill } from '@/src/lib/server/skills';
import { invalid, notFound, sessionUserId, SkillContentSchema, skillErrorResponse, unauthorized } from '@/src/lib/server/skill-routes';

type Context = { params: Promise<{ id: string }> };

// Any subset: content edits, or just { enabled } to turn a skill on or off.
const patchSchema = SkillContentSchema.partial().extend({ enabled: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change');

export async function GET(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const skill = await getSkill(userId, (await context.params).id);
  return skill ? Response.json({ skill }) : notFound();
}

export async function PATCH(request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const skill = await updateSkill(userId, (await context.params).id, parsed.data);
    return skill ? Response.json({ skill }) : notFound();
  } catch (error) {
    return skillErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  return (await deleteSkill(userId, (await context.params).id)) ? new Response(null, { status: 204 }) : notFound();
}
