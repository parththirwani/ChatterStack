import { describe, expect, it } from 'vitest';
import {
  MAX_SKILL_NAME,
  SkillInputSchema,
  frontmatterFields,
  inferCategories,
  normalizeSkillName,
  normalizeSkillPath,
  parseSkillFile,
  serializeSkill,
} from '@/src/lib/skills/skill-file';

describe('parseSkillFile', () => {
  it('reads an Agent Skills SKILL.md', () => {
    const text = [
      '---',
      'name: release-notes',
      'description: Write release notes in our house style. Use when drafting a changelog.',
      'license: MIT',
      'allowed-tools: Read Grep',
      '---',
      '',
      '# Release notes',
      '',
      '- Lead with user-facing changes.',
    ].join('\n');
    expect(parseSkillFile(text)).toEqual({
      name: 'release-notes',
      description: 'Write release notes in our house style. Use when drafting a changelog.',
      instructions: '# Release notes\n\n- Lead with user-facing changes.',
      frontmatter: 'license: MIT\nallowed-tools: Read Grep',
    });
  });

  it('keeps other frontmatter, including nested maps, verbatim for export', () => {
    const text = '---\nname: unslop\ndisable-model-invocation: true\ndescription: Cut AI tells.\nmetadata:\n  author: me\n  version: "1.0"\n---\nBody';
    const parsed = parseSkillFile(text);
    expect(parsed.frontmatter).toBe('disable-model-invocation: true\nmetadata:\n  author: me\n  version: "1.0"');
    expect(parseSkillFile(serializeSkill(parsed))).toEqual(parsed);
    expect(frontmatterFields(parsed.frontmatter)).toEqual([['disable-model-invocation', 'true']]);
  });

  it('handles quoted, folded and literal values, CRLF and a BOM', () => {
    const text = '\uFEFF---\r\nname: "Code Review"\r\ndescription: >\r\n  Reviews code\r\n  for bugs.\r\nmetadata:\r\n  version: "1"\r\n---\r\nBody';
    expect(parseSkillFile(text)).toMatchObject({ name: 'code-review', description: 'Reviews code for bugs.', instructions: 'Body' });

    const literal = "---\nname: 'it''s'\ndescription: |\n  Line one\n  Line two\n---\nBody";
    expect(parseSkillFile(literal)).toMatchObject({ name: 'it-s', description: 'Line one\nLine two' });
  });

  it('ignores comments and folds plain multi-line values', () => {
    const text = '---\nname: tidy # a comment\ndescription: first part\n  second part\nother: "say \\"hi\\" # x" # real comment\n---\nBody';
    expect(parseSkillFile(text)).toMatchObject({ name: 'tidy', description: 'first part second part' });
  });

  it('falls back to the heading and first paragraph without frontmatter', () => {
    const text = '# Meeting Minutes\n\nTurn a transcript into\nconcise minutes.\n\n## Steps\n1. Summarise';
    expect(parseSkillFile(text)).toEqual({
      name: 'meeting-minutes',
      description: 'Turn a transcript into concise minutes.',
      instructions: text,
    });
  });

  it('uses the fallback name when the file names nothing', () => {
    expect(parseSkillFile('Just do it well.', 'My Skill.md').name).toBe('my-skill');
  });
});

describe('serializeSkill', () => {
  it('round-trips through the parser, including awkward descriptions', () => {
    const skill = { name: 'quotes', description: 'Use "quotes": and # hashes\nsafely', instructions: '## Do\nThings' };
    expect(parseSkillFile(serializeSkill(skill))).toEqual(skill);
  });
});

describe('normalizeSkillName', () => {
  it('produces a valid slug', () => {
    expect(normalizeSkillName('  Résumé -- Writer!! ')).toBe('resume-writer');
    expect(normalizeSkillName('a'.repeat(70))).toHaveLength(MAX_SKILL_NAME);
    expect(normalizeSkillName(`${'a'.repeat(63)}-b`)).toBe('a'.repeat(63));
  });
});

describe('SkillInputSchema', () => {
  it('accepts a valid skill and rejects bad names and empty fields', () => {
    expect(SkillInputSchema.safeParse({ name: 'ok-name', description: 'd', instructions: 'i' }).success).toBe(true);
    expect(SkillInputSchema.safeParse({ name: 'Bad Name', description: 'd', instructions: 'i' }).success).toBe(false);
    expect(SkillInputSchema.safeParse({ name: 'ok', description: ' ', instructions: 'i' }).success).toBe(false);
    expect(SkillInputSchema.safeParse({ name: 'ok', description: 'd', instructions: 'x'.repeat(60001) }).success).toBe(false);
  });
});

describe('normalizeSkillPath', () => {
  it('accepts relative paths and refuses traversal, absolute paths and SKILL.md', () => {
    expect(normalizeSkillPath('./references//style.md')).toBe('references/style.md');
    expect(normalizeSkillPath('../x.md')).toBeNull();
    expect(normalizeSkillPath('/etc/passwd')).toBeNull();
    expect(normalizeSkillPath('a\\b.md')).toBeNull();
    expect(normalizeSkillPath('skill.md')).toBeNull();
  });
});

describe('inferCategories', () => {
  it('guesses up to three categories from the name and description', () => {
    expect(inferCategories({ name: 'code-review', description: 'Find bugs in a pull request.' })).toEqual(['Code']);
    expect(inferCategories({ name: 'cover-letter', description: 'Write a tailored cover letter for a job application.' })).toEqual(['Writing', 'Jobs & career']);
    expect(inferCategories({ name: 'x', description: 'zzz' })).toEqual([]);
  });
});
