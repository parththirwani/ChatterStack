import { z } from 'zod';

/**
 * Skills use the Agent Skills `SKILL.md` format: YAML frontmatter with `name`
 * and `description`, then Markdown instructions. This module has no server
 * dependencies, so the editor and the API routes share one set of rules.
 */

export const MAX_SKILL_NAME = 64;
export const MAX_SKILL_DESCRIPTION = 1024;
// Skill text is sent with every message it's tagged on and counts toward the
// daily token limit, so it is kept well under that limit.
export const MAX_SKILL_INSTRUCTIONS = 8000;
export const MAX_SKILLS_PER_USER = 50;
export const MAX_SKILLS_PER_MESSAGE = 3;
export const MAX_SKILL_FILE_SIZE = 64 * 1024;

export const SKILL_SOURCES = ['created', 'generated', 'imported'] as const;
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

export interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;
}

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
  const lines = block.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!match) continue;
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
  return values;
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
    const values = parseFrontmatter(frontmatter[1]);
    return {
      name: normalizeSkillName(values.name ?? fallbackName),
      description: (values.description ?? '').trim(),
      instructions: source.slice(frontmatter[0].length).trim(),
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
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions.trim()}\n`;
}
