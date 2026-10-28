import { SKILL_CATALOG } from './skill-catalog';
import externalContent from './external-skill-content.json';

/** Full instructions stay on the server; Discover only needs catalog metadata. */
export function findCatalogSkill(id: string) {
  const entry = SKILL_CATALOG.find((skill) => skill.id === id);
  if (!entry) return undefined;
  const instructions = (externalContent as Record<string, string>)[id] ?? entry.instructions;
  return { ...entry, instructions };
}
