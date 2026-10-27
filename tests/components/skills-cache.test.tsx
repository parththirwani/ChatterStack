import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { currentSkills, refreshSkills, resetSkillsCache, useSkills } from '@/src/lib/client/skills';

const named = (name: string) => ({ id: name, name, enabled: true });
let pending: Array<(names: string[]) => void>;

beforeEach(() => {
  resetSkillsCache();
  pending = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
    pending.push((names) => resolve(Response.json({ skills: names.map(named) })));
  })));
});

afterEach(() => vi.unstubAllGlobals());

const names = (skills: Array<{ name: string }>) => skills.map((skill) => skill.name);

describe('the shared skills list', () => {
  it('keeps the newest refresh even when an older one answers last', async () => {
    const { result } = renderHook(() => useSkills('user-1'));
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0](['a', 'b']);
    await waitFor(() => expect(names(result.current.skills)).toEqual(['a', 'b']));

    // Two quick changes: the first refresh was fetched before the second change.
    void refreshSkills();
    void refreshSkills();
    pending[2](['a']);
    await waitFor(() => expect(names(result.current.skills)).toEqual(['a']));
    pending[1](['a', 'b']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(names(result.current.skills)).toEqual(['a']);
  });

  it('refreshes once per change, however many components use it', async () => {
    renderHook(() => useSkills('user-1'));
    renderHook(() => useSkills('user-1'));
    await waitFor(() => expect(pending).toHaveLength(1));
    window.dispatchEvent(new Event('chatterstack:skills-changed'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('currentSkills waits for a load in progress, so a message sent early keeps its skills', async () => {
    const skills = currentSkills('user-1');
    await waitFor(() => expect(pending).toHaveLength(1));
    void refreshSkills();
    pending[0](['old']);
    pending[1](['writer']);
    expect(names(await skills)).toEqual(['writer']);
    expect(await currentSkills('guest')).toEqual([]);
  });
});
