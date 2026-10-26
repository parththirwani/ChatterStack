import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { MAX_SKILL_FILE_SIZE, parseSkillFile, SkillInputSchema } from '@/src/lib/skills/skill-file';

const importSchema = z.object({
  content: z.string().min(1, 'The file is empty').max(MAX_SKILL_FILE_SIZE, 'The file is larger than 64 KB'),
  fileName: z.string().max(180).optional(),
});

/**
 * Parses SKILL.md text into a draft for the editor. Nothing is saved: the
 * user reviews the draft (and fixes any problems) before creating the skill.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid file' }, { status: 400 });
  const fallback = parsed.data.fileName?.replace(/(\.skill)?\.md$/i, '').replace(/^skill$/i, '') ?? '';
  const draft = parseSkillFile(parsed.data.content, fallback);
  const checked = SkillInputSchema.safeParse(draft);
  return Response.json({
    draft,
    issues: checked.success ? [] : checked.error.issues.map((issue) => ({ field: String(issue.path[0]), message: issue.message })),
  });
}
