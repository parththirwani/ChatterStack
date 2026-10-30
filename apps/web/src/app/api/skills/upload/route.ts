import { createSkill, SkillError, updateSkill } from '@/src/lib/server/skills';
import { MAX_UPLOAD_SIZE, parseSkillUpload, SkillBundleError } from '@/src/lib/server/skill-bundle';
import { sessionUserId, unauthorized } from '@/src/lib/server/skill-routes';
import type { SkillUploadResult } from '@/src/types/skill.types';

const MAX_FILES_PER_UPLOAD = 10;

/**
 * Uploads one or more skills (.md, .zip or .skill) as multipart `files`.
 * With `replaceId`, the single uploaded file replaces that skill's content.
 * Each file gets its own result, so one bad file doesn't block the rest.
 */
export async function POST(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll('files') ?? []).filter((entry): entry is File => typeof entry !== 'string');
  const replaceId = form?.get('replaceId');
  if (!files.length) return Response.json({ error: 'Choose a file to upload.' }, { status: 400 });
  if (files.length > MAX_FILES_PER_UPLOAD) return Response.json({ error: `Upload up to ${MAX_FILES_PER_UPLOAD} files at once.` }, { status: 400 });
  if (typeof replaceId === 'string' && files.length !== 1) return Response.json({ error: 'Replace takes exactly one file.' }, { status: 400 });

  const results: SkillUploadResult[] = [];
  for (const file of files) {
    const result: SkillUploadResult = { fileName: file.name, checks: [], warnings: [] };
    try {
      if (file.size > MAX_UPLOAD_SIZE) throw new SkillBundleError('The file is larger than 5 MB.');
      const bundle = parseSkillUpload(file.name, new Uint8Array(await file.arrayBuffer()));
      result.checks = bundle.checks;
      result.warnings = bundle.warnings;
      const content = { ...bundle.skill, files: bundle.files };
      if (typeof replaceId === 'string') {
        const replaced = await updateSkill(userId, replaceId, { frontmatter: undefined, ...content });
        if (!replaced) throw new SkillError('Skill not found', 404);
        result.skill = replaced;
      } else {
        result.skill = await createSkill(userId, content, 'uploaded');
      }
    } catch (error) {
      if (!(error instanceof SkillBundleError) && !(error instanceof SkillError)) throw error;
      result.error = error.message;
    }
    results.push(result);
  }
  const status = results.every((result) => result.error) ? 400 : 200;
  return Response.json({ results }, { status });
}
