import { beforeEach, describe, expect, it } from 'vitest';
import { overridesFor, useProfileStore, type ProfileOverrides } from '@/src/store/profileStore';

describe('profile store (mock)', () => {
  beforeEach(() => {
    useProfileStore.getState().resetProfile();
  });

  it('starts with empty overrides so the session identity shows through', () => {
    const { name, bio, avatarUrl } = useProfileStore.getState();
    expect(name).toBe('');
    expect(bio).toBe('');
    expect(avatarUrl).toBeNull();
  });

  it('merges partial updates without clobbering other fields', () => {
    useProfileStore.getState().updateProfile({ name: 'Parth', bio: 'Builds agents' });
    useProfileStore.getState().updateProfile({ avatarUrl: 'data:image/png;base64,abc' });

    const state = useProfileStore.getState();
    expect(state.name).toBe('Parth');
    expect(state.bio).toBe('Builds agents');
    expect(state.avatarUrl).toBe('data:image/png;base64,abc');
  });

  it('distinguishes "never edited" (null) from "photo removed" ("")', () => {
    useProfileStore.getState().updateProfile({ avatarUrl: 'data:image/png;base64,abc' });
    useProfileStore.getState().updateProfile({ avatarUrl: '' });
    expect(useProfileStore.getState().avatarUrl).toBe('');

    useProfileStore.getState().resetProfile();
    expect(useProfileStore.getState().avatarUrl).toBeNull();
  });

  it('keeps one account\'s edits away from another account on the same device', () => {
    useProfileStore.getState().updateProfile({ ownerId: 'user-a', name: 'Alice', bio: 'Hi', avatarUrl: 'data:image/png;base64,abc' });
    const state = useProfileStore.getState();
    expect(overridesFor(state, 'user-a')).toEqual({ name: 'Alice', bio: 'Hi', avatarUrl: 'data:image/png;base64,abc' });
    expect(overridesFor(state, 'user-b')).toEqual({ name: '', bio: '', avatarUrl: null });
    expect(overridesFor(state, undefined)).toEqual({ name: '', bio: '', avatarUrl: null });
  });

  it('treats a profile saved before the photo field as never edited', () => {
    // localStorage written by an older build has no avatarUrl key at all.
    const legacy = { ownerId: 'user-a', name: 'Ada', bio: 'Hi', avatarUrl: undefined } as unknown as ProfileOverrides;
    expect(overridesFor(legacy, 'user-a')).toEqual({ name: 'Ada', bio: 'Hi', avatarUrl: null });
  });
});
