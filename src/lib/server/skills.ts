import { prisma } from '@/src/lib/prisma';
import { MAX_SKILLS_PER_USER, type SkillInput, type SkillSource } from '@/src/lib/skills/skill-file';
import type { Skill, SkillTag } from '@/src/types/skill.types';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export class SkillError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function skillMeta(skill: SkillRow): Skill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    source: skill.source as SkillSource,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

export async function listSkills(userId: string) {
  const skills = await prisma.skill.findMany({ where: { userId }, orderBy: { name: 'asc' } });
  return skills.map(skillMeta);
}

export async function createSkill(userId: string, input: SkillInput, source: SkillSource) {
  if (await prisma.skill.count({ where: { userId } }) >= MAX_SKILLS_PER_USER) {
    throw new SkillError(`You can keep up to ${MAX_SKILLS_PER_USER} skills. Delete one to add another.`, 409);
  }
  try {
    return skillMeta(await prisma.skill.create({ data: { ...input, source, userId } }));
  } catch (error) {
    if (isUniqueViolation(error)) throw new SkillError(`A skill named "${input.name}" already exists.`, 409);
    throw error;
  }
}

/** Returns null when the skill isn't this user's. */
export async function updateSkill(userId: string, id: string, input: SkillInput) {
  try {
    const updated = await prisma.skill.updateMany({ where: { id, userId }, data: input });
    if (!updated.count) return null;
  } catch (error) {
    if (isUniqueViolation(error)) throw new SkillError(`A skill named "${input.name}" already exists.`, 409);
    throw error;
  }
  return skillMeta(await prisma.skill.findUniqueOrThrow({ where: { id } }));
}

export async function getSkill(userId: string, id: string) {
  const skill = await prisma.skill.findFirst({ where: { id, userId } });
  return skill ? skillMeta(skill) : null;
}

export async function deleteSkill(userId: string, id: string) {
  const removed = await prisma.skill.deleteMany({ where: { id, userId } });
  return removed.count > 0;
}

/**
 * The user's skills for these ids, in the order given. Throws if any is
 * missing, so a message never runs without a skill the user tagged.
 */
export async function resolveSkills(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.skill.findMany({ where: { userId, id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const skill = byId.get(id);
    if (!skill) throw new SkillError('A tagged skill no longer exists. Remove it and try again.', 400);
    return skillMeta(skill);
  });
}

export const skillTags = (skills: Array<Pick<Skill, 'id' | 'name'>>): SkillTag[] =>
  skills.map(({ id, name }) => ({ id, name }));
