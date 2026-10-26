import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { MAX_SKILL_DESCRIPTION, MAX_SKILL_INSTRUCTIONS, MAX_SKILL_NAME, SkillInputSchema } from '@/src/lib/skills/skill-file';
import { draftSkill } from '@/src/services/skills/skillCreator';
import { countTokens, recordLLMTokens, withLLMTokenLimit } from '@/src/middleware/llmTokenRateLimit';

const generateSchema = z.object({
  request: z.string().trim().min(1, 'Describe the skill you want').max(2000),
  // An existing draft to revise, as shown in the editor (may be incomplete).
  current: z.object({
    name: z.string().max(MAX_SKILL_NAME),
    description: z.string().max(MAX_SKILL_DESCRIPTION),
    instructions: z.string().max(MAX_SKILL_INSTRUCTIONS),
  }).optional(),
});

/** The skill creator: drafts a skill with a model. The draft is not saved. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });

  const { request: ask, current } = parsed.data;
  const hasCurrent = current && (current.name || current.description || current.instructions);
  const limited = await withLLMTokenLimit(userId, ask + (hasCurrent ? JSON.stringify(current) : ''), false);
  if (limited) return limited;

  try {
    const { draft, prompt, output } = await draftSkill(ask, hasCurrent ? current : undefined, request.signal);
    await recordLLMTokens(userId, countTokens(prompt) + countTokens(output), false).catch((error) =>
      console.error('Failed to record tokens:', error));
    const checked = SkillInputSchema.safeParse(draft);
    return Response.json({
      draft,
      issues: checked.success ? [] : checked.error.issues.map((issue) => ({ field: String(issue.path[0]), message: issue.message })),
    });
  } catch (error) {
    console.error('Skill creator failed:', error);
    return Response.json({ error: 'Could not draft the skill. Try again.' }, { status: 502 });
  }
}
