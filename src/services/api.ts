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

interface UserProfileResponse {
  profile: {
    userId: string;
    technicalLevel: string;
    explanationStyle: string;
    topicFrequency: Record<string, number>;
    preferences: {
      likes?: string[];
      dislikes?: string[];
    };
    messageCount: number;
    lastUpdated: Date;
    version: number;
  };
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
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return response;
  }

  // ============= AUTH =============
  
  static async validateAuth(): Promise<{ ok: boolean; user?: User }> {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return { ok: false };
      }

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
      return { ok: false };
    }
  }

  static async getCurrentUser(): Promise<User | null> {
    try {
      const result = await this.validateAuth();
      if (!result.ok || !result.user) {
        return null;
      }
      return result.user;
    } catch (error) {
      return null;
    }
  }

  static async logout(): Promise<void> {
    window.location.href = '/api/auth/signout';
  }

  // ============= CHAT WITH PROGRESS SUPPORT =============

  static async sendMessage(
    request: ChatRequest,
    onChunk?: (chunk: string) => void,
    onDone?: () => void,
    onConversationId?: (id: string) => void,
    onProgress?: (progress: CouncilProgress) => void
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

            if (parsed.error) {
              throw new Error(parsed.error);
            }
            
            if (parsed.conversationId) {
              onConversationId?.(parsed.conversationId);
            }
            
            // Handle progress events for council mode
            if (parsed.status === 'progress' && parsed.stage && parsed.model !== undefined) {
              onProgress?.({
                stage: parsed.stage,
                model: parsed.model,
                progress: parsed.progress
              });
            }
            
            if (parsed.chunk) {
              onChunk?.(parsed.chunk);
            }
            
            if (parsed.done) {
              onDone?.();
            }
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
    await this.sendMessage(
      {
        message: request.message,
        conversationId: request.conversationId,
        selectedModel: 'council',
      },
      onChunk,
      onDone,
      onConversationId,
      onProgress
    );
  }

  // ============= CONVERSATIONS =============

  static async getConversations(): Promise<{ conversations: Conversation[] }> {
    try {
      const response = await this.fetchWithCredentials('/api/conversations');
      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  static async getConversation(id: string): Promise<{ conversation: Conversation } | null> {
    try {
      const response = await this.fetchWithCredentials(`/api/conversations/${id}`);
      const data = await response.json();
      
      if (!data || !data.conversation) {
        return null;
      }
      
      return data;
    } catch (error) {
      return null;
    }
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
      return { models: [] };
    }
  }

  // ============= RAG =============

  static async refreshProfile(): Promise<void> {
    await this.fetchWithCredentials('/api/rag/profile/refresh', {
      method: 'POST',
    });
  }

  static async getUserProfile(userId?: string): Promise<UserProfileResponse> {
    const url = userId 
      ? `/api/rag/profile/${userId}` 
      : '/api/rag/profile/me';
    
    const response = await this.fetchWithCredentials(url);
    return response.json();
  }
}

export default ApiService;