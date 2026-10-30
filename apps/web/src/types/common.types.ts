export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export type Role = 'user' | 'assistant' | 'system';

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}