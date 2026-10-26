import type { SkillSource } from '@/src/lib/skills/skill-file';

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
  createdAt: string;
  updatedAt: string;
}

/** A skill as tagged on a message. Only the reference is stored. */
export interface SkillTag {
  id: string;
  name: string;
  /** The skill has since been deleted. */
  removed?: boolean;
}
