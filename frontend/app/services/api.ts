// frontend/app/services/api.ts
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export interface User {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  title?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ChatRequest {
  message: string;
  model?: string;
  conversationId?: string;
}

export class ApiService {
  private static baseUrl = BACKEND_URL;

  // Generic fetch wrapper with credentials
  private static async fetchWithCredentials(url: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${url}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  // Authentication methods
  static async validateAuth(): Promise<{ ok: boolean; user?: User }> {
    try {
      const response = await this.fetchWithCredentials('/auth/validate', {
        method: 'POST',
      });
      return await response.json();
    } catch (error) {
      console.error('Auth validation failed:', error);
      return { ok: false };
    }
  }

  static async logout(): Promise<{ success: boolean }> {
    try {
      const response = await this.fetchWithCredentials('/auth/logout', {
        method: 'POST',
      });
      return await response.json();
    } catch (error) {
      console.error('Logout failed:', error);
      return { success: false };
    }
  }

  static async refreshToken(): Promise<{ success: boolean; accessToken?: string }> {
    try {
      const response = await this.fetchWithCredentials('/auth/refresh', {
        method: 'POST',
      });
      return await response.json();
    } catch (error) {
      console.error('Token refresh failed:', error);
      return { success: false };
    }
  }

  // Chat methods
  static async sendMessage(
    request: ChatRequest,
    onChunk?: (chunk: string) => void,
    onConversationId?: (id: string) => void
  ): Promise<{ conversationId?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let conversationId: string | undefined;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                return { conversationId };
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.chunk && onChunk) {
                  onChunk(parsed.chunk);
                }
                if (parsed.conversationId && onConversationId) {
                  conversationId = parsed.conversationId;
                  onConversationId(parsed.conversationId);
                }
              } catch (e) {
                // Ignore invalid JSON
              }
            }
          }
        }
      }

      return { conversationId };
    } catch (error) {
      console.error('Send message failed:', error);
      throw error;
    }
  }

  // Conversation methods
  static async getConversations(): Promise<Conversation[]> {
    try {
      const response = await this.fetchWithCredentials('/ai/conversations');
      return await response.json();
    } catch (error) {
      console.error('Get conversations failed:', error);
      return [];
    }
  }

  static async getConversation(conversationId: string): Promise<{ conversation: Conversation } | null> {
    try {
      const response = await this.fetchWithCredentials(`/ai/conversations/${conversationId}`);
      return await response.json();
    } catch (error) {
      console.error('Get conversation failed:', error);
      return null;
    }
  }
}