// Extract: Generic caching methods
import { RedisClient } from './client';

export class CacheManager {
  constructor(private client: RedisClient) {}
  
  async getKey(key: string): Promise<string | null> {
    return await this.client.getClient().get(key);
  }
  
  async setKey(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.getClient().setEx(key, ttl, value);
    } else {
      await this.client.getClient().set(key, value);
    }
  }
  
  async deleteKey(key: string): Promise<boolean> {
    const deleted = await this.client.getClient().del(key);
    return deleted > 0;
  }
}