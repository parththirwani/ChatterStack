import { Conversation, User } from "../types";
import { ChatRequest } from "../types/chat.types";
import { apiOptimizer } from "./apiOptimizer";

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

// NextAuth session response
interface NextAuthSession {
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  expires?: string;
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

  // ============= AUTH (Fixed) =============
  
  static async validateAuth(): Promise<{ ok: boolean; user?: User }> {
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        console.log('[ApiService] Session fetch failed:', response.status);
        return { ok: false };
      }

      const session: NextAuthSession = await response.json();
      
      console.log('[ApiService] Session response:', session);

      // NextAuth returns { user: {...}, expires: "..." } or {}
      if (session?.user?.id) {
        const user: User = {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          avatarUrl: session.user.image,
        };
        
        console.log('[ApiService] User authenticated:', user.email || user.id);
        return { ok: true, user };
      }

      console.log('[ApiService] No user in session');
      return { ok: false };
    } catch (error) {
      console.error('[ApiService] Session check failed:', error);
      return { ok: false };
    }
  }

  static async getCurrentUser(): Promise<User | null> {
    const result = await this.validateAuth();
    return result.user || null;
  }

  static async logout(): Promise<void> {
    // Just invalidate cache - NextAuth signOut handles the actual logout
    apiOptimizer.invalidateCache('auth:session');
  }

  // ============= CHAT (No caching - streaming) =============

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
          } catch {
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

  // ============= CONVERSATIONS (Optimized) =============

  static async getConversations(): Promise<{ conversations: Conversation[] }> {
    return await apiOptimizer.fetch<{ conversations: Conversation[] }>(
      '/api/conversations',
      { credentials: 'include' }
    );
  }

  static async getConversation(id: string): Promise<{ conversation: Conversation } | null> {
    try {
      return await apiOptimizer.fetch<{ conversation: Conversation }>(
        `/api/conversations/${id}`,
        { credentials: 'include' }
      );
    } catch {
      return null;
    }
  }

  static async deleteConversation(id: string): Promise<void> {
    await this.fetchWithCredentials(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
    
    // Invalidate related caches
    apiOptimizer.invalidateCache(`conversation:${id}`);
    apiOptimizer.invalidateCache('conversations');
  }

  // ============= MODELS (Optimized) =============

  static async getModels() {
    try {
      return await apiOptimizer.fetch<{ models: unknown[] }>(
        '/api/models',
        { credentials: 'include' }
      );
    } catch {
      return { models: [] };
    }
  }

  // ============= RAG (No caching) =============

  static async refreshProfile(): Promise<void> {
    await this.fetchWithCredentials('/api/rag/profile/refresh', {
      method: 'POST',
    });
    
    // Invalidate profile cache
    apiOptimizer.invalidateCache('profile');
  }

  static async getUserProfile(userId?: string): Promise<UserProfileResponse> {
    const url = userId 
      ? `/api/rag/profile/${userId}` 
      : '/api/rag/profile/me';
    
    return await apiOptimizer.fetch<UserProfileResponse>(
      url,
      { credentials: 'include' }
    );
  }
}

export default ApiService;