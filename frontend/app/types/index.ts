// frontend/app/types/index.ts
export interface User {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  updatedAt?: string;
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