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
  // All API calls go to Next.js API routes on port 3000
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

  // ============= AUTH - NextAuth Only =============
  
  static async validateAuth(): Promise<{ ok: boolean; user?: User }> {
    try {
      // Use NextAuth session endpoint
      const response = await fetch('/api/auth/session');
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

  // Login/Logout handled by NextAuth - redirect to sign-in page
  static getLoginUrl(): string {
    return '/api/auth/signin';
  }

  static getLogoutUrl(): string {
    return '/api/auth/signout';
  }

  // ============= CHAT =============

  static async sendMessage(request: ChatRequest): Promise<ReadableStream> {
    const response = await this.fetchWithCredentials('/api/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.body) {
      throw new Error('No response body');
    }

    return response.body;
  }

  // ============= CONVERSATIONS =============

  static async getConversations(): Promise<Conversation[]> {
    const response = await this.fetchWithCredentials('/api/conversations');
    return response.json();
  }

  static async getConversation(id: string): Promise<Conversation> {
    const response = await this.fetchWithCredentials(`/api/conversations/${id}`);
    return response.json();
  }

  static async deleteConversation(id: string): Promise<void> {
    await this.fetchWithCredentials(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
  }

  static async updateConversationTitle(id: string, title: string): Promise<void> {
    await this.fetchWithCredentials(`/api/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
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

  // ============= COUNCIL =============

  static async sendCouncilMessage(request: CouncilChatRequest): Promise<ReadableStream> {
    const response = await this.fetchWithCredentials('/api/council', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.body) {
      throw new Error('No response body');
    }

    return response.body;
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