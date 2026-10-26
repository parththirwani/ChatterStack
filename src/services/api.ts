import { Conversation, User } from "../types";
import type {
  ChatRequest,
  CouncilAnswer,
  CouncilProgress,
  CouncilRanking,
  SSEData,
} from "../types/chat.types";
import { apiOptimizer, cacheInvalidators, HttpError } from "./apiOptimizer";

export interface ChatStreamHandlers {
  onChunk?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onDone?: () => void;
  onConversationId?: (id: string) => void;
  /** The server has saved a new chat's row. */
  onConversationCreated?: (id: string) => void;
  onTitle?: (title: string) => void;
  onProgress?: (progress: CouncilProgress) => void;
  onCouncilAnswer?: (answer: CouncilAnswer) => void;
  onCouncilRankings?: (rankings: CouncilRanking[]) => void;
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
        return { ok: false };
      }

      const session: NextAuthSession = await response.json();
      

      // NextAuth returns { user: {...}, expires: "..." } or {}
      if (session?.user?.id) {
        const user: User = {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          avatarUrl: session.user.image,
        };
        
        return { ok: true, user };
      }

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
    // NextAuth signOut ends the session; drop everything cached for this user.
    cacheInvalidators.all();
  }

  // ============= CHAT (No caching - streaming) =============

  static async sendMessage(
    request: ChatRequest,
    handlers: ChatStreamHandlers = {},
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(typeof error.error === 'string' ? error.error : `Chat API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    // Returns true once the stream signals completion.
    const handleLine = (line: string): boolean => {
      if (!line.startsWith('data: ')) return false;
      const data = line.slice(6);

      if (data === '[DONE]') {
        handlers.onDone?.();
        return true;
      }

      let parsed: SSEData;
      try {
        parsed = JSON.parse(data);
      } catch {
        return false;
      }

      if (parsed.error) {
        throw new Error(parsed.error);
      }
      if (parsed.conversationId) {
        handlers.onConversationId?.(parsed.conversationId);
      }
      if (parsed.conversationCreated) {
        handlers.onConversationCreated?.(parsed.conversationCreated);
      }
      if (parsed.title) {
        handlers.onTitle?.(parsed.title);
      }
      if (parsed.status === 'progress' && parsed.stage && parsed.model !== undefined) {
        handlers.onProgress?.({
          stage: parsed.stage,
          model: parsed.model,
          progress: parsed.progress ?? 0,
        });
      }
      if (parsed.councilAnswer) {
        handlers.onCouncilAnswer?.(parsed.councilAnswer);
      }
      if (parsed.councilRankings) {
        handlers.onCouncilRankings?.(parsed.councilRankings);
      }
      if (parsed.reasoning) {
        handlers.onReasoning?.(parsed.reasoning);
      }
      if (parsed.chunk) {
        handlers.onChunk?.(parsed.chunk);
      }
      if (parsed.done) {
        handlers.onDone?.();
      }
      return false;
    };

    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        if (handleLine(line)) return;
      }
    }

    pending += decoder.decode();
    if (pending) handleLine(pending);
  }

  // ============= CONVERSATIONS (Optimized) =============

  static async getConversations(): Promise<{ conversations: Conversation[] }> {
    return await apiOptimizer.fetch<{ conversations: Conversation[] }>(
      '/api/conversations',
      { credentials: 'include' }
    );
  }

  /** `null` if the chat doesn't exist (or isn't yours); throws on other failures. */
  static async getConversation(id: string): Promise<{ conversation: Conversation } | null> {
    try {
      return await apiOptimizer.fetch<{ conversation: Conversation }>(
        `/api/conversations/${id}`,
        { credentials: 'include' }
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  static async updateConversation(
    id: string,
    updates: { title?: string; pinned?: boolean }
  ): Promise<Pick<Conversation, 'id' | 'title' | 'pinnedAt' | 'updatedAt'>> {
    const response = await this.fetchWithCredentials(`/api/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    cacheInvalidators.conversationList();
    cacheInvalidators.conversation(id);
    const { conversation } = await response.json();
    return conversation;
  }

  static async deleteConversation(id: string): Promise<void> {
    await this.fetchWithCredentials(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
    cacheInvalidators.conversationList();
    cacheInvalidators.conversation(id);
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
