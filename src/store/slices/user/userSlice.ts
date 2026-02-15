// src/store/slices/user/userSlice.ts

import { StateCreator } from 'zustand';
import { ApiService } from '../../../services/api';
import type { User } from '@/src/types/user.types';

// We extend the return type so TypeScript knows reset exists when we call get()
export interface UserSlice {
  user: User | null;
  userLoading: boolean;
  setUser: (user: User | null) => void;
  setUserLoading: (loading: boolean) => void;
  initializeUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const createUserSlice: StateCreator<UserSlice> = (set, get) => ({
  user: null,
  userLoading: true,

  setUser: (user) => set({ user }),
  setUserLoading: (userLoading) => set({ userLoading }),

  initializeUser: async () => {
    const { setUser, setUserLoading } = get();
    try {
      setUserLoading(true);
      
      // Use getCurrentUser which returns null instead of throwing
      const currentUser = await ApiService.getCurrentUser();
      
      if (currentUser) {
        console.log('[UserSlice] User authenticated:', currentUser.email);
        setUser(currentUser);
      } else {
        console.log('[UserSlice] No authenticated user');
        setUser(null);
      }
    } catch (error) {
      // This shouldn't happen anymore, but handle it gracefully
      console.log('[UserSlice] Failed to initialize user, setting to null');
      setUser(null);
    } finally {
      setUserLoading(false);
    }
  },

  logout: async () => {
    try {
      await ApiService.logout();
      const fullStore = get() as typeof get extends () => infer T ? T : never;
      if ('reset' in fullStore && typeof fullStore.reset === 'function') {
        fullStore.reset();
      }
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  },
});