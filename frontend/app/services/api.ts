import { ChatRequest, Conversation, User } from "../types";

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export class ApiService {
  private static baseUrl = BACKEND_URL;

  private static getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const accessToken = document.cookie
      .split('; ')
      .find(row => row.startsWith('access_token='))
      ?.split('=')[1];

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    return headers;
  }

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

  static async getCurrentUser(): Promise<User | null> {
    try {
      console.log('Getting current user...');
      const result = await this.validateAuth();
      if (result.ok && result.user) {
        console.log('Current user:', result.user);
        return result.user;
      }
      console.log('No authenticated user');
      return null;
    } catch (error) {
      console.error('Get current user failed:', error);
      return null;
    }
  }

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

  static async sendMessage(
    request: ChatRequest,
    onChunk?: (chunk: string) => void,
    onDone?: () => void,
    onConversationId?: (id: string) => void
  ): Promise<{ conversationId?: string }> {
    try {
      console.log('=== Sending Message ===');
      console.log('Request:', request);

      const response = await fetch(`${this.baseUrl}/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...this.getAuthHeaders(),
          Accept: 'text/event-stream',
        },
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
                if (onDone) onDone();
                return { conversationId };
              }

              try {
                const parsed = JSON.parse(data);
                console.log('Parsed SSE data:', parsed);

                if (parsed.status === 'starting') {
                  continue;
                }
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
                if (parsed.conversationId && onConversationId) {
                  conversationId = parsed.conversationId;
                  onConversationId(parsed.conversationId);
                }
                if (parsed.chunk && onChunk) {
                  onChunk(parsed.chunk);
                }
                if (parsed.done && onDone) {
                  onDone();
                }
              } catch {
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

  static async deleteConversation(conversationId: string): Promise<void> {
    try {
      await this.fetchWithCredentials(`/ai/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      console.log(`Conversation ${conversationId} deleted successfully`);
    } catch (error) {
      console.error('Error deleting conversation:', error);
      throw error;
    }
  }
}