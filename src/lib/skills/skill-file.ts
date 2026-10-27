import { z } from 'zod';

/**
 * Skills use the Agent Skills `SKILL.md` format: YAML frontmatter with `name`
 * and `description`, then Markdown instructions. This module has no server
 * dependencies, so the editor and the API routes share one set of rules.
 */

export const MAX_SKILL_NAME = 64;
export const MAX_SKILL_DESCRIPTION = 1024;
// Large enough for real Agent Skills. Skill text is sent with every message
// it's tagged on and counts toward the daily token limit; the editor shows
// the cost per use.
export const MAX_SKILL_INSTRUCTIONS = 60000;
export const MAX_SKILLS_PER_USER = 50;
export const MAX_SKILLS_PER_MESSAGE = 3;
export const MAX_SKILL_FILE_SIZE = 64 * 1024;
// Supporting files (references, templates, scripts) bundled with a skill.
export const MAX_SKILL_FILES = 50;
export const MAX_SKILL_FILE_TEXT = 256 * 1024;
export const MAX_SKILL_FILES_TOTAL = 1024 * 1024;
export const MAX_SKILL_EXTRA_FRONTMATTER = 4000;

export const SKILL_SOURCES = ['created', 'generated', 'uploaded', 'catalog'] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SkillInputSchema = z.object({
  name: z.string().trim()
    .min(1, 'Add a name')
    .max(MAX_SKILL_NAME, `Use ${MAX_SKILL_NAME} characters or fewer`)
    .regex(NAME_PATTERN, 'Use lowercase letters, numbers and single hyphens'),
  description: z.string().trim()
    .min(1, 'Add a description')
    .max(MAX_SKILL_DESCRIPTION, `Use ${MAX_SKILL_DESCRIPTION} characters or fewer`),
  instructions: z.string().trim()
    .min(1, 'Add instructions')
    .max(MAX_SKILL_INSTRUCTIONS, `Use ${MAX_SKILL_INSTRUCTIONS.toLocaleString('en-US')} characters or fewer`),
});

export type SkillInput = z.infer<typeof SkillInputSchema>;

export interface SkillFile {
  /** Relative path inside the skill folder, e.g. `references/style.md`. */
  path: string;
  content: string;
}

export interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;
  /** Frontmatter lines other than name and description, kept verbatim. */
  frontmatter?: string;
}

/** A safe relative path for a bundled file, or null. */
export function normalizeSkillPath(path: string): string | null {
  const clean = path.trim().replace(/^\.\/+/, '').replace(/\/{2,}/g, '/');
  if (!clean || clean.length > 200 || clean.startsWith('/') || clean.includes('\\') || /[\x00-\x1f]/.test(clean)) return null;
  const parts = clean.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (clean.toLowerCase() === 'skill.md') return null;
  return clean;
}

export const SkillFilesSchema = z.array(z.object({
  path: z.string().min(1).max(200).refine((path) => normalizeSkillPath(path) === path, 'Use a relative path like references/notes.md'),
  content: z.string().max(MAX_SKILL_FILE_TEXT, 'Each file must be 256 KB or less'),
})).max(MAX_SKILL_FILES, `Add up to ${MAX_SKILL_FILES} files`)
  .refine((files) => new Set(files.map((file) => file.path)).size === files.length, 'Two files have the same path')
  .refine((files) => files.reduce((size, file) => size + file.content.length, 0) <= MAX_SKILL_FILES_TOTAL, 'Files must total 1 MB or less');

/** Turns any text (a title, a file name) into a valid skill name. */
export function normalizeSkillName(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_NAME)
    .replace(/-+$/, '');
}

function unquote(value: string) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * Reads the top-level scalar keys of a frontmatter block. Supports plain,
 * quoted and block (`|`, `>`) values; nested maps and lists are skipped.
 */
function parseFrontmatter(block: string) {
  const values: Record<string, string> = {};
  const extra: string[] = [];
  const lines = block.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!match) {
      if (lines[index].trim()) extra.push(lines[index]);
      continue;
    }
    const entryStart = index;
    const [, key, raw] = match;
    const trimmed = raw.trim();
    // `#` starts a comment only outside quotes.
    const quoted = trimmed.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^']|'')*'/)?.[0];
    const value = quoted ?? trimmed.replace(/\s+#.*$/, '');
    const continuation: string[] = [];
    while (index + 1 < lines.length && (/^[ \t]+\S/.test(lines[index + 1]) || (lines[index + 1].trim() === '' && /^[|>]/.test(value)))) {
      continuation.push(lines[index + 1]);
      index += 1;
    }
    if (key !== 'name' && key !== 'description') extra.push(...lines.slice(entryStart, index + 1));
    if (/^[|>][+-]?$/.test(value)) {
      const indent = Math.min(...continuation.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0));
      const body = continuation.map((line) => line.slice(Number.isFinite(indent) ? indent : 0));
      values[key] = value.startsWith('|')
        ? body.join('\n').trim()
        : body.join('\n').trim().split(/\n{2,}/).map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ')).join('\n');
    } else if (continuation.length && !value) {
      // A nested map or list; not a value this app reads.
      continue;
    } else {
      values[key] = unquote([value, ...continuation.map((line) => line.trim())].join(' ').trim());
    }
  }
  return { values, extra: extra.join('\n').trim() };
}

/**
 * Parses `SKILL.md` text. Without frontmatter, the first `# Heading` becomes
 * the name and the first paragraph the description. Values are not validated
 * here; run the result through SkillInputSchema.
 */
export function parseSkillFile(text: string, fallbackName = ''): ParsedSkill {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const frontmatter = source.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (frontmatter) {
    const { values, extra } = parseFrontmatter(frontmatter[1]);
    return {
      name: normalizeSkillName(values.name ?? fallbackName),
      description: (values.description ?? '').trim(),
      instructions: source.slice(frontmatter[0].length).trim(),
      ...(extra ? { frontmatter: extra.slice(0, MAX_SKILL_EXTRA_FRONTMATTER) } : {}),
    };
  }

  const heading = source.match(/^#[ \t]+(.+)$/m);
  const body = source.trim();
  const afterHeading = heading ? body.slice(body.indexOf(heading[0]) + heading[0].length).trim() : body;
  const firstParagraph = afterHeading.split(/\n{2,}/).find((paragraph) => paragraph.trim() && !paragraph.trim().startsWith('#')) ?? '';
  return {
    name: normalizeSkillName(heading?.[1] ?? fallbackName),
    description: firstParagraph.replace(/\s*\n\s*/g, ' ').trim().slice(0, MAX_SKILL_DESCRIPTION),
    instructions: body,
  };
}

/** Writes a skill as `SKILL.md`. JSON strings are valid YAML double-quoted scalars. */
export function serializeSkill(skill: ParsedSkill) {
  const extra = skill.frontmatter?.trim() ? `${skill.frontmatter.trim()}\n` : '';
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n${extra}---\n\n${skill.instructions.trim()}\n`;
}

/** Scalar frontmatter values for display, e.g. `license: MIT`. */
export function frontmatterFields(frontmatter = ''): Array<[string, string]> {
  return Object.entries(parseFrontmatter(frontmatter).values);
}

export const SKILL_CATEGORIES = [
  'Writing', 'Code', 'Data & analysis', 'Research', 'Productivity', 'Design',
  'Education', 'Jobs & career', 'Files & documents', 'Marketing',
] as const;

const CATEGORY_WORDS: Record<(typeof SKILL_CATEGORIES)[number], RegExp> = {
  Writing: /\b(writ\w*|edit\w*|essay|blog|tone|prose|copy|grammar|proofread\w*|email)\b/i,
  Code: /\b(code|coding|program\w*|debug\w*|refactor\w*|function|api|typescript|python|javascript|bug|pull request|pr)\b/i,
  'Data & analysis': /\b(data|sql|spreadsheet|csv|chart|statistic\w*|analy[sz]\w*|metric\w*|dashboard)\b/i,
  Research: /\b(research\w*|sources?|literature|citations?|investigat\w*|fact[- ]check\w*)\b/i,
  Productivity: /\b(plan\w*|tasks?|meeting\w*|status|summar\w*|notes?|agenda|schedul\w*|todo)\b/i,
  Design: /\b(design\w*|ui|ux|layout|visual\w*|brand\w*|figma|colou?rs?)\b/i,
  Education: /\b(learn\w*|teach\w*|explain\w*|quiz\w*|tutor\w*|study|lesson\w*|flashcards?)\b/i,
  'Jobs & career': /\b(resume|résumé|cv|cover letter|interview\w*|job|career|application\w*|phd|linkedin)\b/i,
  'Files & documents': /\b(documents?|docs?|pdf|docx|files?|reports?|templates?|proposal\w*|spec\w*)\b/i,
  Marketing: /\b(marketing|campaign\w*|seo|social media|audience|launch\w*|newsletter\w*|ads?)\b/i,
};

/** Up to three categories guessed from the skill's name and description. */
export function inferCategories(skill: Pick<ParsedSkill, 'name' | 'description'>): string[] {
  const text = `${skill.name.replace(/-/g, ' ')} ${skill.description}`;
  return SKILL_CATEGORIES.filter((category) => CATEGORY_WORDS[category].test(text)).slice(0, 3);
}

/** Rough token cost of sending a skill, for the editor. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
