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

export interface Message {
  id?: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  modelId?: string; // Added to track which LLM generated the response
}

export interface Conversation {
  id: string;
  title?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ChatState {
  messages: Message[];
  currentConversationId?: string;
  loading: boolean;
  error?: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string; 
  selectedModels: string[];
}

export interface AIModel {
  id: string;
  name: string;
  description: string;
  logo: string;
  company: string;
  tier: 'Premium' | 'Pro' | 'Free';
  capabilities?: string[];
}

export interface ChatInterfaceProps {
  user?: User | null;
  selectedConversationId?: string;
  onConversationCreated?: (conversationId: string) => void;
  onNewChatStarted?: () => void;
}