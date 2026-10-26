import type { SkillFile, SkillSource } from '@/src/lib/skills/skill-file';

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
  enabled: boolean;
  categories: string[];
  files: SkillFile[];
  /** Frontmatter lines other than name and description. */
  frontmatter?: string;
  version: number;
  catalogId: string | null;
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

/** Result for one file in an upload. */
export interface SkillUploadResult {
  fileName: string;
  skill?: Skill;
  error?: string;
  checks: string[];
  warnings: string[];
}
