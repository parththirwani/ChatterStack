// frontend/app/types/index.ts
export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Create an alias for backward compatibility
export type UserType = User;

export interface Message {
  id?: string; // Made optional to match API service
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp?: string; // Made optional to match API service
  conversationId?: string;
  metadata?: {
    model?: string;
    tokens?: number;
    processingTime?: number;
  };
}

export interface Conversation {
  id: string;
  title?: string | null; // Allow null to match API service
  messages: Message[];
  userId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    model?: string;
    totalMessages?: number;
    totalTokens?: number;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials extends LoginCredentials {
  name: string;
}

export interface AuthProvider {
  name: string;
  url: string;
  icon?: string;
}

export interface ChatSettings {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  chatSettings?: ChatSettings;
  sidebarCollapsed?: boolean;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type ConversationStatus = 'active' | 'archived' | 'deleted';

export interface ConversationFilter {
  status?: ConversationStatus;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}