import { z } from 'zod';
import { createSkill, listSkills } from '@/src/lib/server/skills';
import { invalid, sessionUserId, SkillContentSchema, skillErrorResponse, unauthorized } from '@/src/lib/server/skill-routes';

// Uploads and catalog additions have their own routes.
const createSchema = SkillContentSchema.extend({ source: z.enum(['created', 'generated']).default('created') });

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  return Response.json({ skills: await listSkills(userId) });
}

export async function POST(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const { source, ...content } = parsed.data;
  try {
    return Response.json({ skill: await createSkill(userId, content, source) }, { status: 201 });
  } catch (error) {
    return skillErrorResponse(error);
  }
}
