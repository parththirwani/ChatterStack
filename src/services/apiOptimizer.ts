// src/services/apiOptimizer.ts
// Smart caching and request deduplication for API calls

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  expiresAt: number;
};

type PendingRequest<T> = Promise<T>;

class ApiOptimizer {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private pendingRequests: Map<string, PendingRequest<unknown>> = new Map();

  // Cache TTLs (in milliseconds)
  private readonly TTL = {
    auth: 10 * 1000, // 10 seconds
    conversations: 30 * 1000, // 30 seconds
    conversation: 60 * 1000, // 1 minute
    models: 5 * 60 * 1000, // 5 minutes
    default: 30 * 1000, // 30 seconds
  };

  /**
   * Get TTL for a specific cache key
   */
  private getTTL(key: string): number {
    if (key.includes('/auth/session')) return this.TTL.auth;
    if (key === '/conversations' || key.includes('/conversations?')) return this.TTL.conversations;
    if (key.includes('/conversations/') && !key.includes('/messages')) return this.TTL.conversation;
    if (key.includes('/models')) return this.TTL.models;
    return this.TTL.default;
  }

  /**
   * Generate cache key from URL and options
   */
  private getCacheKey(url: string, options?: RequestInit): string {
    const method = options?.method || 'GET';
    const body = options?.body ? JSON.stringify(options.body) : '';
    return `${method}:${url}:${body}`;
  }

  /**
   * Get cached data if valid
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Store data in cache
   */
  private setCache<T>(key: string, data: T): void {
    const now = Date.now();
    const ttl = this.getTTL(key);
    
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttl,
    });
  }

  /**
   * Clear cache entries matching a pattern
   */
  invalidateCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Optimized fetch with caching and deduplication
   */
  async fetch<T>(
    url: string,
    options?: RequestInit
  ): Promise<T> {
    const cacheKey = this.getCacheKey(url, options);
    const method = options?.method || 'GET';

    // Only cache GET requests
    if (method === 'GET') {
      // Check cache first
      const cached = this.getFromCache<T>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Check if request is already pending (deduplication)
      const pending = this.pendingRequests.get(cacheKey) as PendingRequest<T> | undefined;
      if (pending) {
        return pending;
      }
    }

    // Make the request
    const request = (async () => {
      try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as T;

        // Cache successful GET requests
        if (method === 'GET') {
          this.setCache(cacheKey, data);
        }

        return data;
      } finally {
        // Remove from pending requests
        this.pendingRequests.delete(cacheKey);
      }
    })();

    // Store pending request for deduplication
    if (method === 'GET') {
      this.pendingRequests.set(cacheKey, request as PendingRequest<unknown>);
    }

    return request;
  }

  /**
   * Clear cache on mutations
   */
  onMutation(pattern: string): void {
    this.invalidateCache(pattern);
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      pendingRequests: this.pendingRequests.size,
    };
  }
}

// Singleton instance
export const apiOptimizer = new ApiOptimizer();

/**
 * Optimized fetch wrapper
 */
export async function optimizedFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  return apiOptimizer.fetch<T>(url, options);
}

/**
 * Invalidate cache after mutations
 */
export function invalidateCache(pattern?: string): void {
  apiOptimizer.invalidateCache(pattern);
}

/**
 * Helper to invalidate specific patterns
 */
export const cacheInvalidators = {
  conversations: () => invalidateCache('/conversations'),
  conversation: (id: string) => invalidateCache(`/conversations/${id}`),
  auth: () => invalidateCache('/auth/session'),
  all: () => invalidateCache(),
};