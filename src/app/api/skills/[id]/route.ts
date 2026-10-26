import { auth } from '@/src/lib/auth';
import { SkillInputSchema } from '@/src/lib/skills/skill-file';
import { deleteSkill, getSkill, SkillError, updateSkill } from '@/src/lib/server/skills';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const skill = await getSkill(session.user.id, (await context.params).id);
  return skill ? Response.json({ skill }) : Response.json({ error: 'Skill not found' }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = SkillInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid skill', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const skill = await updateSkill(session.user.id, (await context.params).id, parsed.data);
    return skill ? Response.json({ skill }) : Response.json({ error: 'Skill not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof SkillError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const removed = await deleteSkill(session.user.id, (await context.params).id);
  return removed ? new Response(null, { status: 204 }) : Response.json({ error: 'Skill not found' }, { status: 404 });
}
