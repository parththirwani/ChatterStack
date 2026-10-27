import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/prisma';
import { findCatalogSkill } from '@/src/config/skill-catalog';
import {
  inferCategories,
  MAX_SKILL_NAME,
  MAX_SKILLS_PER_USER,
  type ParsedSkill,
  type SkillFile,
  type SkillSource,
} from '@/src/lib/skills/skill-file';
import type { Skill, SkillTag } from '@/src/types/skill.types';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: string;
  enabled: boolean;
  categories: string[];
  files: unknown;
  metadata: unknown;
  version: number;
  catalogId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SkillError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function skillMeta(skill: SkillRow): Skill {
  const metadata = (skill.metadata ?? {}) as { frontmatter?: string };
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    source: skill.source as SkillSource,
    enabled: skill.enabled,
    categories: skill.categories ?? [],
    files: Array.isArray(skill.files) ? (skill.files as SkillFile[]) : [],
    ...(metadata.frontmatter ? { frontmatter: metadata.frontmatter } : {}),
    version: skill.version,
    catalogId: skill.catalogId,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

// The row was deleted after we read it.
const isMissingRow = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2025';

const nameTaken = (name: string) => new SkillError(`A skill named "${name}" already exists.`, 409);

export interface SkillContent extends ParsedSkill {
  files?: SkillFile[];
}

/** Columns for a skill's content. Categories are guessed unless given. */
function contentData(content: SkillContent, categories?: string[]) {
  return {
    name: content.name,
    description: content.description,
    instructions: content.instructions,
    files: (content.files ?? []) as unknown as Prisma.InputJsonValue,
    metadata: (content.frontmatter ? { frontmatter: content.frontmatter } : {}) as Prisma.InputJsonValue,
    categories: categories ?? inferCategories(content),
  };
}

export async function listSkills(userId: string) {
  const skills = await prisma.skill.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
  return skills.map(skillMeta);
}

export async function createSkill(
  userId: string,
  content: SkillContent,
  source: SkillSource,
  extra: { categories?: string[]; catalogId?: string } = {},
) {
  if (await prisma.skill.count({ where: { userId } }) >= MAX_SKILLS_PER_USER) {
    throw new SkillError(`You can keep up to ${MAX_SKILLS_PER_USER} skills. Remove one to add another.`, 409);
  }
  try {
    return skillMeta(await prisma.skill.create({
      data: { ...contentData(content, extra.categories), source, catalogId: extra.catalogId ?? null, userId },
    }));
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(content.name);
    throw error;
  }
}

export interface SkillPatch extends Partial<SkillContent> {
  enabled?: boolean;
}

/** Applies a change; content changes bump the version. Null if not this user's. */
export async function updateSkill(userId: string, id: string, patch: SkillPatch) {
  const current = await prisma.skill.findFirst({ where: { id, userId } });
  if (!current) return null;
  const { enabled, ...content } = patch;
  const changesContent = Object.keys(content).length > 0;
  const merged: SkillContent = {
    name: content.name ?? current.name,
    description: content.description ?? current.description,
    instructions: content.instructions ?? current.instructions,
    files: content.files ?? (Array.isArray(current.files) ? current.files as unknown as SkillFile[] : []),
    frontmatter: 'frontmatter' in content ? content.frontmatter : ((current.metadata ?? {}) as { frontmatter?: string }).frontmatter,
  };
  try {
    const updated = await prisma.skill.update({
      where: { id },
      data: {
        ...(enabled === undefined ? {} : { enabled }),
        ...(changesContent ? {
          ...contentData(merged, current.source === 'catalog' ? current.categories : undefined),
          version: { increment: 1 },
        } : {}),
      },
    });
    return skillMeta(updated);
  } catch (error) {
    if (isMissingRow(error)) return null;
    if (isUniqueViolation(error)) throw nameTaken(merged.name);
    throw error;
  }
}

export async function getSkill(userId: string, id: string) {
  const skill = await prisma.skill.findFirst({ where: { id, userId } });
  return skill ? skillMeta(skill) : null;
}

export async function deleteSkill(userId: string, id: string) {
  const removed = await prisma.skill.deleteMany({ where: { id, userId } });
  return removed.count > 0;
}

const copySuffix = (index: number) => (index === 1 ? '-copy' : `-copy-${index}`);

/** A name based on `base` that the user doesn't have yet: base-copy, base-copy-2, … by default. */
async function freeName(userId: string, base: string, suffix: (index: number) => string = copySuffix) {
  const taken = new Set((await prisma.skill.findMany({ where: { userId }, select: { name: true } })).map((skill) => skill.name));
  for (let index = 1; ; index += 1) {
    const end = suffix(index);
    const name = `${base.slice(0, MAX_SKILL_NAME - end.length).replace(/-+$/, '')}${end}`;
    if (!taken.has(name)) return name;
  }
}

export async function duplicateSkill(userId: string, id: string) {
  const skill = await getSkill(userId, id);
  if (!skill) return null;
  return createSkill(userId, { ...skill, name: await freeName(userId, skill.name) }, skill.source === 'catalog' ? 'created' : skill.source, { categories: skill.categories });
}

/** Adds a Discover skill. Adding it again returns the existing copy (turned back on). */
export async function addCatalogSkill(userId: string, catalogId: string) {
  const entry = findCatalogSkill(catalogId);
  if (!entry) throw new SkillError('That skill is not in the catalog.', 404);
  const existing = await prisma.skill.findFirst({ where: { userId, catalogId } });
  if (existing) {
    if (!existing.enabled) return skillMeta(await prisma.skill.update({ where: { id: existing.id }, data: { enabled: true } }));
    return skillMeta(existing);
  }
  // A skill of the user's own may already have the catalog name: keep theirs
  // and add this one as name-2 (the caller tags whatever name comes back).
  const name = await freeName(userId, entry.name, (index) => (index === 1 ? '' : `-${index}`));
  return createSkill(userId, { ...entry, name }, 'catalog', { categories: entry.categories, catalogId });
}

/**
 * The user's skills for these ids, in the order given. Throws if any is
 * missing or turned off, so a message never runs without a skill the user tagged.
 */
export async function resolveSkills(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.skill.findMany({ where: { userId, id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const skill = byId.get(id);
    if (!skill) throw new SkillError('A tagged skill no longer exists. Remove it and try again.', 400);
    if (!skill.enabled) throw new SkillError(`The skill /${skill.name} is turned off. Turn it on in Customize, or remove it from the message.`, 400);
    return skillMeta(skill);
  });
}

export const skillTags = (skills: Array<Pick<Skill, 'id' | 'name'>>): SkillTag[] =>
  skills.map(({ id, name }) => ({ id, name }));
