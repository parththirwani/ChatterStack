import { getSkill } from '@/src/lib/server/skills';
import { buildSkillZip } from '@/src/lib/server/skill-bundle';
import { notFound, sessionUserId, unauthorized } from '@/src/lib/server/skill-routes';

type Context = { params: Promise<{ id: string }> };

/** The skill as `<name>.zip` with `<name>/SKILL.md`, which Claude's upload accepts. */
export async function GET(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const skill = await getSkill(userId, (await context.params).id);
  if (!skill) return notFound();
  return new Response(Buffer.from(buildSkillZip(skill)), {
    headers: {
      'Content-Type': 'application/zip',
      // The name is a slug, so it is safe in a header.
      'Content-Disposition': `attachment; filename="${skill.name}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
