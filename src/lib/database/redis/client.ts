// Extract: Redis client creation and connection
import { createClient } from 'redis';

export class RedisClient {
  private client: ReturnType<typeof createClient> | null = null;
  private isConnected = false;
  
  async connect() {
    if (this.isConnected) return;
    
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    
    await this.client.connect();
    this.isConnected = true;
  }
  
  getClient() {
    if (!this.client) throw new Error('Redis not connected');
    return this.client;
  }
}