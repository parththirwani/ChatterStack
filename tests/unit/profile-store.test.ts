import { beforeEach, describe, expect, it } from 'vitest';
import { useProfileStore } from '@/src/store/profileStore';

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
});
