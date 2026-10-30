import { describe, expect, it } from 'vitest';
import externalSkills from '@/src/config/external-skill-catalog.json';
import sources from '@/src/config/external-skill-sources.json';
import { findCatalogSkill } from '@/src/config/skill-catalog.server';
import { MAX_SKILL_INSTRUCTIONS } from '@/src/lib/skills/skill-file';

describe('external skill catalog', () => {
  it('includes every pinned source skill with usable catalog metadata and its full instructions', () => {
    expect(externalSkills).toHaveLength(139);
    expect(new Set(externalSkills.map((skill) => skill.id)).size).toBe(externalSkills.length);
    expect(sources.reduce((total, source) => total + source.skillCount, 0)).toBe(externalSkills.length);

    for (const skill of externalSkills) {
      const source = sources.find((item) => item.source === skill.sourceName);
      expect(source, skill.id).toBeDefined();
      expect(skill.sourceUrl).toContain(`/blob/${source!.commit}/`);
      expect(skill.categories).toContain(skill.stack);
      const found = findCatalogSkill(skill.id);
      expect(found?.instructions.length, skill.id).toBeGreaterThan(0);
      expect(found!.instructions.length, skill.id).toBeLessThanOrEqual(MAX_SKILL_INSTRUCTIONS);
    }
  });

  it('indexes the requested sources by their domains', () => {
    const count = (domain: string) => externalSkills.filter((skill) => skill.categories.includes(domain)).length;
    expect(count('Coding')).toBe(94);
    expect(count('UI')).toBe(32);
    expect(count('Writing')).toBe(22);
    expect(findCatalogSkill('mattpocock-ask-matt')?.instructions).toContain('# Ask Matt');
    expect(findCatalogSkill('poteto-poteto-mode')?.instructions).toContain('poteto');
    expect(findCatalogSkill('technical-writing-technical-article-writer')?.instructions).toContain('article');
  });
});
