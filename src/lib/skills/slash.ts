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
