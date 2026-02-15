// src/store/slices/user/userSlice.ts

import { StateCreator } from 'zustand';
import { ApiService } from '../../../services/api';
import { signOut } from 'next-auth/react';
import type { User } from '@/src/types/user.types';

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
      console.error('[UserSlice] Failed to initialize user, setting to null',error);
      setUser(null);
    } finally {
      setUserLoading(false);
    }
  },

  logout: async () => {
    try {
      // Sign out using NextAuth - this clears the session
      await signOut({ redirect: false });
      
      // Reset the entire store
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