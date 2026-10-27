import { describe, expect, it } from 'vitest';
import { matchSkills, removeSlashQuery, skillsInText, slashQueryAt, splitSkillTokens } from '@/src/lib/skills/slash';

describe('slashQueryAt', () => {
  it('finds a /query at the start or after whitespace', () => {
    expect(slashQueryAt('/', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(slashQueryAt('Please /Code-re', 15)).toEqual({ start: 7, end: 15, query: 'code-re' });
    expect(slashQueryAt('line\n/rev', 9)).toMatchObject({ start: 5, query: 'rev' });
  });

  it('ignores slashes inside words, paths and finished words', () => {
    expect(slashQueryAt('and/or', 6)).toBeNull();
    expect(slashQueryAt('see https://x.dev/path', 22)).toBeNull();
    expect(slashQueryAt('/review now', 11)).toBeNull();
    expect(slashQueryAt('/a.b', 4)).toBeNull();
  });

  it('uses the caret, not the end of the text', () => {
    expect(slashQueryAt('/rev and more', 4)).toEqual({ start: 0, end: 4, query: 'rev' });
  });
});

describe('removeSlashQuery', () => {
  it('removes the query and avoids a double space', () => {
    const text = 'Please /code-re this';
    expect(removeSlashQuery(text, slashQueryAt(text, 15)!)).toEqual({ text: 'Please this', caret: 7 });
    expect(removeSlashQuery('/rev', { start: 0, end: 4, query: 'rev' })).toEqual({ text: '', caret: 0 });
  });
});

describe('matchSkills', () => {
  const skills = [
    { name: 'code-review', description: 'Find bugs' },
    { name: 'release-notes', description: 'Changelog writer' },
    { name: 'review-pr', description: 'Pull requests' },
  ];
  it('ranks name prefixes before other matches and searches descriptions', () => {
    expect(matchSkills(skills, 'rev').map((skill) => skill.name)).toEqual(['review-pr', 'code-review']);
    expect(matchSkills(skills, 'changelog').map((skill) => skill.name)).toEqual(['release-notes']);
    expect(matchSkills(skills, '', 2)).toHaveLength(2);
  });
});

describe('skill tokens in text', () => {
  const skills = [{ name: 'code-review' }, { name: 'haiku' }];
  const names = new Set(skills.map((skill) => skill.name));

  it('splits out known /name tokens only', () => {
    expect(splitSkillTokens('Check /code-review, then /unknown and a/haiku /haiku', names)).toEqual([
      { text: 'Check ' },
      { text: '/code-review', skill: 'code-review' },
      { text: ', then /unknown and a/haiku ' },
      { text: '/haiku', skill: 'haiku' },
    ]);
    expect(splitSkillTokens('/code-reviewer', names)).toEqual([{ text: '/code-reviewer' }]);
  });

  it('lists tagged skills once, in order', () => {
    expect(skillsInText('/haiku and /code-review and /haiku', skills).map((skill) => skill.name)).toEqual(['haiku', 'code-review']);
  });
});
