import { ChatRequest, Conversation, User } from "../types";

interface CouncilChatRequest {
  message: string;
  conversationId?: string;
}

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

export class ApiService {
  private static baseUrl = '/api';

  private static getAuthHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  private static async fetchWithCredentials(url: string, options: RequestInit = {}) {
    const fullUrl = url.startsWith('/') ? url : `${this.baseUrl}/${url}`;
    console.log(`API Call: ${options.method || 'GET'} ${fullUrl}`);
    
    const response = await fetch(fullUrl, {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        ...options.headers,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return response;
  }

  // ============= AUTH =============
  
  static async validateAuth(): Promise<{ ok: boolean; user?: User }> {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      const session = await response.json();
      
      if (session?.user) {
        return { 
          ok: true, 
          user: {
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.name || '',
            avatarUrl: session.user.image,
            provider: session.user.provider || 'unknown',
          }
        };
      }
      
      return { ok: false };
    } catch (error) {
      console.error('Auth validation failed:', error);
      return { ok: false };
    }
  }

  static async getCurrentUser(): Promise<User> {
    const result = await this.validateAuth();
    if (!result.ok || !result.user) {
      throw new Error('Not authenticated');
    }
    return result.user;
  }

  static async logout(): Promise<void> {
    window.location.href = '/api/auth/signout';
  }

  // ============= CHAT =============

  static async sendMessage(
    request: ChatRequest,
    onChunk?: (chunk: string) => void,
    onDone?: () => void,
    onConversationId?: (id: string) => void
  ): Promise<void> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Chat API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            onDone?.();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.conversationId) onConversationId?.(parsed.conversationId);
            if (parsed.chunk) onChunk?.(parsed.chunk);
            if (parsed.done) onDone?.();
          } catch (e) {
            // Ignore invalid JSON
          }
        }
      }
    }
  }

  static async sendCouncilMessage(
    request: CouncilChatRequest,
    onChunk: (chunk: string) => void,
    onProgress: (progress: CouncilProgress) => void,
    onDone: () => void,
    onConversationId: (id: string) => void
  ): Promise<void> {
    // Council mode uses the same /api/chat endpoint with model='council'
    await this.sendMessage(
      {
        message: request.message,
        conversationId: request.conversationId,
        selectedModel: 'council',
      },
      onChunk,
      onDone,
      onConversationId
    );
  }

  // ============= CONVERSATIONS =============

  static async getConversations(): Promise<{ conversations: Conversation[] }> {
    const response = await this.fetchWithCredentials('/api/conversations');
    return response.json();
  }

  static async getConversation(id: string): Promise<{ conversation: Conversation }> {
    const response = await this.fetchWithCredentials(`/api/conversations/${id}`);
    return response.json();
  }

  static async deleteConversation(id: string): Promise<void> {
    await this.fetchWithCredentials(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
  }

  // ============= MODELS =============

  static async getModels() {
    try {
      const response = await this.fetchWithCredentials('/api/models');
      return response.json();
    } catch (e) {
      console.error('Failed to fetch models:', e);
      return { models: [] };
    }
  }

  // ============= RAG =============

  static async refreshProfile(): Promise<void> {
    await this.fetchWithCredentials('/api/rag/profile/refresh', {
      method: 'POST',
    });
  }

  static async getUserProfile(userId?: string): Promise<any> {
    const url = userId 
      ? `/api/rag/profile/${userId}` 
      : '/api/rag/profile/me';
    
    const response = await this.fetchWithCredentials(url);
    return response.json();
  }
}

export default ApiService;