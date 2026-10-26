import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { SKILL_SOURCES, SkillInputSchema } from '@/src/lib/skills/skill-file';
import { createSkill, listSkills, SkillError } from '@/src/lib/server/skills';

const createSchema = SkillInputSchema.extend({ source: z.enum(SKILL_SOURCES).default('created') });

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ skills: await listSkills(session.user.id) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid skill', issues: parsed.error.issues }, { status: 400 });
  }
  const { source, ...input } = parsed.data;
  try {
    return Response.json({ skill: await createSkill(session.user.id, input, source) }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
