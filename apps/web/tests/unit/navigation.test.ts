import { describe, expect, it } from 'vitest';
import { appPageFromSegments, appViewFromPath } from '@/src/lib/navigation';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const parse = (path: string) => appPageFromSegments(path.split('/').filter(Boolean));

describe('appPageFromSegments', () => {
  it('reads every app page', () => {
    expect(parse('/resources')).toEqual({ kind: 'resources' });
    expect(parse('/scheduled')).toEqual({ kind: 'scheduled' });
    expect(parse(`/scheduled/${ID}`)).toEqual({ kind: 'scheduled', taskId: ID });
    expect(parse('/customize')).toEqual({ kind: 'skills', tab: 'discover' });
    expect(parse('/customize/skills')).toEqual({ kind: 'skills', tab: 'discover' });
    expect(parse('/customize/skills/yours')).toEqual({ kind: 'skills', tab: 'yours' });
    expect(parse('/customize/skills/new/upload')).toEqual({ kind: 'skills', tab: 'upload' });
    expect(parse(`/customize/skills/${ID}`)).toEqual({ kind: 'skills', tab: 'skill', skillId: ID, section: 'overview' });
    expect(parse(`/customize/skills/${ID}/contents`)).toMatchObject({ skillId: ID, section: 'contents' });
  });

  it.each([
    '/resources/x', '/resources/a/b/c', '/customize/foo', '/customize/skills/yours/x', '/customize/skills/new',
    '/customize/skills/not-an-id', `/customize/skills/${ID}/other`, `/customize/skills/${ID}/contents/x`,
    '/scheduled/not-an-id', `/scheduled/${ID}/x`,
  ])('has no page for %s (a 404)', (path) => {
    expect(parse(path)).toBeNull();
  });
});

describe('appViewFromPath', () => {
  it('treats other paths as chats', () => {
    expect(appViewFromPath('/')).toEqual({ kind: 'chat' });
    expect(appViewFromPath(`/${ID}`)).toEqual({ kind: 'chat' });
  });
});
