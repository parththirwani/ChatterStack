/** A `/query` being typed at the caret, which opens the skill picker. */
export interface SlashQuery {
  /** Index of the `/`. */
  start: number;
  /** Index of the caret (end of the query). */
  end: number;
  query: string;
}

/**
 * The `/word` ending at the caret, if it starts the text or follows
 * whitespace. "a/b" and URLs are left alone.
 */
export function slashQueryAt(text: string, caret: number): SlashQuery | null {
  const match = text.slice(0, caret).match(/(^|\s)\/([a-z0-9-]{0,64})$/i);
  if (!match) return null;
  const start = caret - match[2].length - 1;
  return { start, end: caret, query: match[2].toLowerCase() };
}

/** Removes the `/query` from the text; returns the text and the new caret. */
export function removeSlashQuery(text: string, { start, end }: SlashQuery) {
  const after = text.slice(end);
  // Don't leave a double space where the tag was.
  const before = text.slice(0, start);
  const joined = before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after;
  return { text: joined, caret: start };
}

/** Skills matching the query: name prefix first, then name or description contains. */
export function matchSkills<T extends { name: string; description: string }>(skills: T[], query: string, limit = 6): T[] {
  const q = query.toLowerCase();
  if (!q) return skills.slice(0, limit);
  const prefix = skills.filter((skill) => skill.name.startsWith(q));
  const contains = skills.filter((skill) => !skill.name.startsWith(q) &&
    (skill.name.includes(q) || skill.description.toLowerCase().includes(q)));
  return [...prefix, ...contains].slice(0, limit);
}

const TOKEN = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s.,!?;:)\]])/g;

/** Text split into plain runs and `/name` tokens for known skill names. */
export function splitSkillTokens(text: string, names: ReadonlySet<string>) {
  const parts: Array<{ text: string; skill?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = (match.index ?? 0) + match[1].length;
    if (!names.has(match[2])) continue;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: `/${match[2]}`, skill: match[2] });
    last = start + match[2].length + 1;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The skills tagged in a message as `/name` tokens, in order, without repeats. */
export function skillsInText<T extends { name: string }>(text: string, skills: readonly T[]): T[] {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const found: T[] = [];
  for (const part of splitSkillTokens(text, new Set(byName.keys()))) {
    const skill = part.skill ? byName.get(part.skill) : undefined;
    if (skill && !found.includes(skill)) found.push(skill);
  }
  return found;
}
