import { auth } from '@/src/lib/auth';
import { serializeSkill } from '@/src/lib/skills/skill-file';
import { getSkill } from '@/src/lib/server/skills';

type Context = { params: Promise<{ id: string }> };

/** Downloads the skill as an Agent Skills `SKILL.md`. */
export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const skill = await getSkill(session.user.id, (await context.params).id);
  if (!skill) return Response.json({ error: 'Skill not found' }, { status: 404 });
  return new Response(serializeSkill(skill), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // The name is a slug, so it is safe in a header.
      'Content-Disposition': `attachment; filename="${skill.name}.SKILL.md"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
