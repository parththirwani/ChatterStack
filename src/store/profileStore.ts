import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Mock profile store. Edits to name, bio, and avatar live here (persisted to
 * localStorage only); nothing is sent to the server until the profile API
 * exists. Empty values mean "fall back to the sign-in provider's data".
 */
export interface ProfileOverrides {
  /** Display name; '' when the session name should be used. */
  name: string;
  bio: string;
  /** Photo picked in the profile modal. null = never edited (use the provider's photo), '' = removed on this device. */
  avatarUrl: string | null;
}

interface ProfileState extends ProfileOverrides {
  updateProfile: (patch: Partial<ProfileOverrides>) => void;
  resetProfile: () => void;
}

const EMPTY_PROFILE: ProfileOverrides = { name: '', bio: '', avatarUrl: null };

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      ...EMPTY_PROFILE,
      updateProfile: (patch) => set(patch),
      resetProfile: () => set(EMPTY_PROFILE),
    }),
    {
      name: 'chatterstack:profile',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
