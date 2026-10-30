import { strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate';
import {
  MAX_SKILL_FILE_TEXT,
  MAX_SKILL_FILES,
  MAX_SKILL_FILES_TOTAL,
  normalizeSkillPath,
  parseSkillFile,
  serializeSkill,
  SkillInputSchema,
  type ParsedSkill,
  type SkillFile,
} from '@/src/lib/skills/skill-file';

/**
 * Reads uploaded skills in the formats Claude accepts: a `.md` SKILL.md, or a
 * `.zip` / `.skill` archive containing one. Nothing is written to disk and
 * nothing is executed; the checks below are structural.
 */

export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 200;
const MAX_ENTRY_SIZE = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_TOTAL = 10 * 1024 * 1024;
const SCRIPT_EXTENSIONS = /\.(py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd)$/i;
const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\.git\/)/;

export class SkillBundleError extends Error {}

export interface ParsedBundle {
  skill: ParsedSkill;
  files: SkillFile[];
  /** What the checks found, shown to the user after upload. */
  checks: string[];
  warnings: string[];
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function asText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes).replace(/^﻿/, '');
  } catch {
    return null;
  }
}

function validated(skill: ParsedSkill) {
  const checked = SkillInputSchema.safeParse(skill);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new SkillBundleError(`SKILL.md ${String(issue.path[0])}: ${issue.message}`);
  }
  return { ...skill, ...checked.data };
}

function parseMarkdown(text: string, where = 'The file') {
  if (!/^﻿?---[ \t]*\r?\n/.test(text)) {
    throw new SkillBundleError(`${where} must start with YAML frontmatter containing name and description.`);
  }
  return validated(parseSkillFile(text));
}

/** Parses one uploaded file by its extension. */
export function parseSkillUpload(fileName: string, bytes: Uint8Array): ParsedBundle {
  if (bytes.length > MAX_UPLOAD_SIZE) throw new SkillBundleError('The file is larger than 5 MB.');
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.md')) {
    const text = asText(bytes);
    if (text === null) throw new SkillBundleError('The file is not UTF-8 text.');
    return { skill: parseMarkdown(text), files: [], checks: ['SKILL.md frontmatter is valid'], warnings: [] };
  }

  if (!lower.endsWith('.zip') && !lower.endsWith('.skill')) {
    throw new SkillBundleError('Upload a .md, .zip or .skill file.');
  }

  let entries = 0;
  let declared = 0;
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, {
      // Checked before anything is inflated, so an archive bomb is refused cheaply.
      filter: (file: UnzipFileInfo) => {
        entries += 1;
        declared += file.originalSize;
        if (entries > MAX_ARCHIVE_ENTRIES) throw new SkillBundleError(`The archive has more than ${MAX_ARCHIVE_ENTRIES} entries.`);
        if (file.originalSize > MAX_ENTRY_SIZE || declared > MAX_UNCOMPRESSED_TOTAL) {
          throw new SkillBundleError('The archive is too large once unpacked.');
        }
        return !file.name.endsWith('/') && !IGNORED.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof SkillBundleError) throw error;
    throw new SkillBundleError('The file is not a valid zip archive.');
  }

  const names = Object.keys(archive);
  for (const name of names) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new SkillBundleError(`Unsafe path in archive: ${name}`);
    }
  }

  // SKILL.md at the root, or inside a single top-level folder.
  const skillPaths = names.filter((name) => /(^|\/)SKILL\.md$/i.test(name)).sort((a, b) => a.split('/').length - b.split('/').length);
  const skillPath = skillPaths[0];
  if (!skillPath || skillPath.split('/').length > 2) {
    throw new SkillBundleError('The archive must contain a SKILL.md at its root or in one top-level folder.');
  }
  const prefix = skillPath.slice(0, skillPath.length - 'SKILL.md'.length);
  const skillText = asText(archive[skillPath]);
  if (skillText === null) throw new SkillBundleError('SKILL.md is not UTF-8 text.');
  const skill = parseMarkdown(skillText, 'SKILL.md');

  const files: SkillFile[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  const scripts: string[] = [];
  let total = 0;
  for (const name of names) {
    if (name === skillPath) continue;
    if (!name.startsWith(prefix)) {
      skipped.push(name);
      continue;
    }
    const path = normalizeSkillPath(name.slice(prefix.length));
    const text = asText(archive[name]);
    if (!path || text === null || text.length > MAX_SKILL_FILE_TEXT ||
      files.length >= MAX_SKILL_FILES || total + text.length > MAX_SKILL_FILES_TOTAL) {
      skipped.push(name.slice(prefix.length));
      continue;
    }
    if (SCRIPT_EXTENSIONS.test(path)) scripts.push(path);
    total += text.length;
    files.push({ path, content: text });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  if (skipped.length) warnings.push(`Skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} that are binary, too large or outside the skill folder: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`);
  if (scripts.length) warnings.push(`Scripts are stored but never run in ChatterStack: ${scripts.slice(0, 5).join(', ')}${scripts.length > 5 ? '…' : ''}`);
  return {
    skill,
    files,
    checks: [
      'SKILL.md found and its frontmatter is valid',
      'All paths are relative and stay inside the skill',
      `${files.length} supporting text file${files.length === 1 ? '' : 's'} kept`,
    ],
    warnings,
  };
}

/** `<name>/SKILL.md` plus supporting files, in the layout Claude's upload accepts. */
export function buildSkillZip(skill: ParsedSkill & { files?: SkillFile[] }) {
  const entries: Record<string, Uint8Array> = { [`${skill.name}/SKILL.md`]: strToU8(serializeSkill(skill)) };
  for (const file of skill.files ?? []) entries[`${skill.name}/${file.path}`] = strToU8(file.content);
  return zipSync(entries, { level: 6 });
}
