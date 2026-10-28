import externalSkills from './external-skill-catalog.json';

/**
 * Skills suggested on Customize → Skills → Discover. Adding one copies it into
 * the user's skills (source "catalog"), where it can be edited like any other.
 * Instructions are kept short: they are sent with every message they're
 * tagged on and add to each prompt.
 */
export interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  categories: string[];
  instructions: string;
  /** Discover domain and original project, when this entry comes from one. */
  stack?: 'Coding' | 'UI' | 'Writing';
  sourceName?: string;
  sourceUrl?: string;
  requiresFiles?: boolean;
  /** Shown in the large card at the top of Discover. */
  featured?: boolean;
}

export const SKILL_CREATOR_ID = 'skill-creator';

export const SKILL_STACKS = [
  { name: 'Coding', description: 'Plan, build, review and simplify code.' },
  { name: 'UI', description: 'Shape interfaces and explain ideas visually.' },
  { name: 'Writing', description: 'Write technical articles for developers.' },
] as const;

export const SKILL_CATALOG: CatalogSkill[] = [
  {
    id: SKILL_CREATOR_ID,
    name: 'skill-creator',
    description: 'Create new skills and improve existing ones. Use when the user wants to turn a workflow, style or checklist into a reusable skill.',
    categories: ['Productivity', 'Writing'],
    featured: true,
    instructions: `# Skill creator

Help the user write a skill: reusable instructions that ChatterStack adds to a message when the user tags it with /skill-name.

## Process
1. Ask what the skill should do, when it should be used, and for one or two example requests. Ask at most three questions at a time.
2. Ask about output format, tone, and things to avoid if the user hasn't said.
3. Draft the skill and show it as one SKILL.md in a single \`\`\`markdown code block:

\`\`\`markdown
---
name: kebab-case-name
description: What the skill does and when to use it, in one or two sentences.
---

# Title

Instructions, steps, output format, and one short example if it helps.
\`\`\`

4. Ask for feedback and revise. Always show the full updated SKILL.md, never a partial diff.

## Writing good skills
- Name: lowercase words joined by hyphens, at most 64 characters.
- Description: say both what it does and when to use it.
- Instructions: specific, imperative, and short (under about 400 words). Each word costs tokens every time the skill is used.
- The model can't run code, browse, or open files that aren't attached to the chat, so don't rely on scripts or tools.

When the draft is final, tell the user to press **Save as skill** under the code block.`,
  },
  {
    id: 'code-review',
    name: 'code-review',
    description: 'Review code for bugs, security issues and readability, and list fixes by severity. Use when the user shares code or a diff and asks for a review.',
    categories: ['Code'],
    instructions: `# Code review

Review the code the user shares.

1. Read it fully before commenting. Infer the language, framework and intent.
2. Look for, in order: correctness bugs, security problems (injection, auth, secrets, unsafe input), data loss, concurrency issues, performance traps, then readability.
3. Report findings as a table: Severity (High/Medium/Low), Location, Problem, Fix. Most severe first.
4. For each High finding, show a corrected snippet.
5. End with what is done well, in one or two sentences.

Don't invent problems to fill the table. If the code is fine, say so.`,
  },
  {
    id: 'release-notes',
    name: 'release-notes',
    description: 'Turn commits, PR titles or a changelog dump into clear release notes for users. Use when drafting release notes or a changelog entry.',
    categories: ['Writing', 'Code'],
    instructions: `# Release notes

Write release notes from the changes the user provides.

- Group under: New, Improved, Fixed, and Breaking changes. Omit empty groups.
- Lead with what users can now do, not how it was built. One line per item, present tense.
- Merge duplicates and drop internal-only changes (refactors, CI, tests) unless they affect users.
- Put breaking changes first, with the action users must take.
- End with a one-sentence summary suitable for a tweet.`,
  },
  {
    id: 'meeting-notes',
    name: 'meeting-notes',
    description: 'Turn a meeting transcript or rough notes into a summary with decisions, action items and owners. Use after a meeting.',
    categories: ['Productivity'],
    instructions: `# Meeting notes

From the transcript or notes provided, produce:

**Summary**: three sentences at most.
**Decisions**: bullet list. Only things actually decided.
**Action items**: table of Owner | Task | Due date. Use "Unassigned" or "No date" rather than guessing.
**Open questions**: anything raised but not resolved.

Use the participants' names as written. Don't add commentary.`,
  },
  {
    id: 'explain-simply',
    name: 'explain-simply',
    description: 'Explain a concept step by step from first principles, with an analogy and a quick check question. Use when the user wants to understand how or why something works.',
    categories: ['Education'],
    instructions: `# Explain simply

1. Start with a one-sentence answer.
2. Build up from what the user likely already knows, one idea per short paragraph.
3. Give one concrete analogy, and say where it breaks down.
4. Show a small worked example.
5. End with one question the user can answer to check their understanding (put the answer in a spoiler-style "Answer:" line).

Avoid jargon; define any term you must use.`,
  },
  {
    id: 'research-brief',
    name: 'research-brief',
    description: 'Write a balanced research brief that compares options, cites what is known and flags uncertainty. Use when the user asks to compare options or research a topic.',
    categories: ['Research', 'Data & analysis'],
    instructions: `# Research brief

Structure:
1. **Question**: restate it precisely.
2. **Short answer**: two or three sentences.
3. **Options compared**: a table with the criteria that matter to the user.
4. **Evidence**: what is well established vs. contested. Name sources you rely on; never invent citations or numbers.
5. **Uncertainty**: what you don't know and how the user could find out.
6. **Recommendation**: tied to the user's stated constraints.

Note that your knowledge has a cutoff and may be outdated for fast-moving topics.`,
  },
  {
    id: 'cover-letter',
    name: 'cover-letter',
    description: 'Draft a tailored cover letter from a job description and the user’s background. Use for job applications.',
    categories: ['Jobs & career', 'Writing'],
    instructions: `# Cover letter

Ask for the job description and the user's résumé or background if they're missing.

- 250–350 words, four short paragraphs: hook tied to the company, two proofs of fit with numbers, why this role, close with a call to action.
- Mirror the job description's key requirements, using the user's real experience only. Never invent achievements.
- Plain, confident tone. No clichés ("I am writing to apply", "passionate", "team player").`,
  },
  {
    id: 'sql-helper',
    name: 'sql-helper',
    description: 'Write and explain SQL queries from a plain-language question and a schema. Use for database queries, reports and debugging SQL.',
    categories: ['Data & analysis', 'Code'],
    instructions: `# SQL helper

1. If the schema isn't given, ask for table and column names (or state your assumptions explicitly).
2. Ask which database (PostgreSQL, MySQL, SQLite, SQL Server, BigQuery) if it changes the syntax.
3. Write the query with clear aliases and one comment per non-obvious step.
4. Explain how it works in a short list, and note edge cases: NULLs, duplicates, time zones, empty results.
5. Suggest an index if the query would scan a large table.`,
  },
  ...(externalSkills as CatalogSkill[]).map((skill) => ({ ...skill, instructions: '' })),
];

export const findCatalogEntry = (id: string | null) => SKILL_CATALOG.find((skill) => skill.id === id);
