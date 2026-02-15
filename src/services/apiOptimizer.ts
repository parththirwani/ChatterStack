type PendingRequest<T> = Promise<T>;
type RequestCache<T> = Map<string, { data: T; timestamp: number }>;

class APIOptimizer {
  private pendingRequests: Map<string, PendingRequest<any>> = new Map();
  private cache: RequestCache<any> = new Map();
  private readonly DEFAULT_CACHE_TIME = 5000; // 5 seconds

  /**
   * Deduplicate simultaneous identical requests
   */
  async deduplicate<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    // If already pending, return existing promise
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key)!;
    }

    // Create new request
    const promise = fetcher().finally(() => {
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Cache response with TTL
   */
  getCached<T>(key: string, maxAge: number = this.DEFAULT_CACHE_TIME): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Store in cache
   */
  setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Combined deduplicate + cache
   */
  async optimizedFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    cacheTime: number = this.DEFAULT_CACHE_TIME
  ): Promise<T> {
    // Check cache first
    const cached = this.getCached<T>(key, cacheTime);
    if (cached !== null) {
      return cached;
    }

    // Deduplicate and fetch
    const data = await this.deduplicate(key, fetcher);
    this.setCache(key, data);
    return data;
  }

  /**
   * Invalidate cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export const apiOptimizer = new APIOptimizer();

/**
 * Generate cache key from request parameters
 */
export function generateCacheKey(
  endpoint: string,
  params?: Record<string, any>
): string {
  if (!params) return endpoint;
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${JSON.stringify(params[key])}`)
    .join('&');
  return `${endpoint}?${sortedParams}`;
}