import type { ChatSettings } from './chat.types';   

export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type UserType = User;

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  chatSettings?: ChatSettings;
  sidebarCollapsed?: boolean;
}