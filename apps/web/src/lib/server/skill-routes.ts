import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { SkillFilesSchema, SkillInputSchema, MAX_SKILL_EXTRA_FRONTMATTER } from '@/src/lib/skills/skill-file';
import { SkillError } from './skills';

/** Shared pieces of the /api/skills routes. */

export async function sessionUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401 });
export const notFound = () => Response.json({ error: 'Skill not found' }, { status: 404 });

export const SkillContentSchema = SkillInputSchema.extend({
  frontmatter: z.string().max(MAX_SKILL_EXTRA_FRONTMATTER).optional(),
  files: SkillFilesSchema.optional(),
});

export function invalid(error: z.ZodError) {
  const issue = error.issues[0];
  return Response.json({ error: issue?.message ?? 'Invalid skill', field: issue ? String(issue.path[0]) : undefined, issues: error.issues }, { status: 400 });
}

/** Turns a SkillError into its response; anything else is rethrown. */
export function skillErrorResponse(error: unknown) {
  if (error instanceof SkillError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}
