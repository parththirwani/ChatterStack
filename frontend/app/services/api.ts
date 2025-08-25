// frontend/app/services/api.ts - Updated with better error handling and auth
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

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

  // Helper to get auth headers
  private static getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Try to get access token from cookie
    const accessToken = document.cookie
      .split('; ')
      .find(row => row.startsWith('access_token='))
      ?.split('=')[1];

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    return headers;
  }

  // Generic fetch wrapper with credentials and better error handling
  private static async fetchWithCredentials(url: string, options: RequestInit = {}) {
    console.log(`API Call: ${options.method || 'GET'} ${url}`);
    
    const response = await fetch(`${this.baseUrl}${url}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...this.getAuthHeaders(),
        ...options.headers,
      },
    });

    console.log(`API Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return response;
  }

  // Authentication methods
  static async validateAuth(): Promise<{ ok: boolean; user?: User }> {
    try {
      console.log('Validating authentication...');
      const response = await this.fetchWithCredentials('/auth/validate', {
        method: 'POST',
      });
      const result = await response.json();
      console.log('Auth validation result:', result);
      return result;
    } catch (error) {
      console.error('Auth validation failed:', error);
      return { ok: false };
    }
  }

  static async logout(): Promise<{ success: boolean }> {
    try {
      console.log('Logging out...');
      const response = await this.fetchWithCredentials('/auth/logout', {
        method: 'POST',
      });
      const result = await response.json();
      console.log('Logout result:', result);
      return result;
    } catch (error) {
      console.error('Logout failed:', error);
      return { success: false };
    }
  }

  static async refreshToken(): Promise<{ success: boolean; accessToken?: string }> {
    try {
      console.log('Refreshing token...');
      const response = await this.fetchWithCredentials('/auth/refresh', {
        method: 'POST',
      });
      const result = await response.json();
      console.log('Token refresh result:', result);
      return result;
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
      console.log('=== Sending Message ===');
      console.log('Request:', request);

      const response = await fetch(`${this.baseUrl}/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(request),
      });

      console.log('Chat response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Chat API error:', response.status, errorText);
        throw new Error(`Chat API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let conversationId: string | undefined;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('Stream completed');
            break;
          }

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                console.log('Stream finished');
                return { conversationId };
              }

              try {
                const parsed = JSON.parse(data);
                console.log('Parsed SSE data:', parsed);
                
                if (parsed.chunk && onChunk) {
                  onChunk(parsed.chunk);
                }
                if (parsed.conversationId && onConversationId) {
                  conversationId = parsed.conversationId;
                  onConversationId(parsed.conversationId);
                }
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch (e) {
                // Ignore invalid JSON chunks but log them
                console.log('Invalid JSON in SSE:', data);
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
      console.log('Fetching conversations...');
      const response = await this.fetchWithCredentials('/ai/conversations');
      const conversations = await response.json();
      console.log('Fetched conversations:', conversations.length);
      return conversations;
    } catch (error) {
      console.error('Get conversations failed:', error);
      return [];
    }
  }

  static async getConversation(conversationId: string): Promise<{ conversation: Conversation } | null> {
    try {
      console.log('Fetching conversation:', conversationId);
      const response = await this.fetchWithCredentials(`/ai/conversations/${conversationId}`);
      const result = await response.json();
      console.log('Fetched conversation:', result);
      return result;
    } catch (error) {
      console.error('Get conversation failed:', error);
      return null;
    }
  }
}