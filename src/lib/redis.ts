import { createClient } from 'redis';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}

class RedisStore {
  private client: ReturnType<typeof createClient> | null = null;
  private isConnected = false;
  private isUpstash = false;
  private connectionAttempted = false;

  async connect() {
    if (this.isConnected) return;
    if (this.connectionAttempted) return; // Prevent multiple connection attempts

    this.connectionAttempted = true;

    try {
      // PRIORITY: Check for Upstash credentials first
      const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
      const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
      const localRedisUrl = process.env.REDIS_URL;

      let redisUrl: string | undefined;
      let redisToken: string | undefined;

      // Determine which Redis to use
      if (upstashUrl && upstashToken) {
        // Use Upstash if credentials are provided
        redisUrl = upstashUrl;
        redisToken = upstashToken;
        this.isUpstash = true;
        console.log('✓ Using Upstash Redis');
      } else if (localRedisUrl) {
        // Fall back to local Redis
        redisUrl = localRedisUrl;
        this.isUpstash = false;
        console.log('✓ Using local Redis');
      } else {
        console.warn('⚠️  No Redis configuration found - Redis features disabled');
        console.log('Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN or REDIS_URL');
        return; // Don't throw, just disable Redis features
      }

      // For Upstash, convert https:// URL to rediss:// format
      if (this.isUpstash && redisUrl) {
        // Upstash URLs come as https://xxx.upstash.io
        // We need rediss://default:token@xxx.upstash.io:6379
        const urlObj = new URL(redisUrl);
        redisUrl = `rediss://default:${redisToken}@${urlObj.hostname}:6379`;
        
        console.log('Connecting to Upstash Redis...');
        
        this.client = createClient({
          url: redisUrl,
          socket: {
            tls: true,
            rejectUnauthorized: true,
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                console.error('Upstash Redis reconnection failed');
                return new Error('Max reconnection attempts reached');
              }
              return retries * 100;
            },
          },
        });
      } else {
        console.log('Connecting to local Redis...');
        
        this.client = createClient({
          url: redisUrl,
          socket: {
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                return new Error('Redis reconnection failed');
              }
              return retries * 100;
            },
          },
        });
      }

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err.message);
        // Don't throw - let the app continue without Redis
      });

      this.client.on('connect', () => {
        console.log(`✓ Redis connected (${this.isUpstash ? 'Upstash' : 'Local'})`);
      });

      this.client.on('ready', () => {
        console.log('✓ Redis ready');
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
        console.log('Redis reconnecting...');
      });

      await this.client.connect();

      // Test connection
      await this.client.ping();
      console.log('✓ Redis connection verified');

    } catch (error) {
      console.error('⚠️  Redis connection failed:', error instanceof Error ? error.message : error);
      console.log('App will continue without Redis caching');
      this.isConnected = false;
      this.client = null;
      // Don't throw - let the app work without Redis
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        this.isConnected = false;
        console.log('Redis disconnected');
      } catch (error) {
        console.error('Error disconnecting Redis:', error);
      }
    }
  }

  async get(conversationId: string): Promise<Message[]> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return []; // Return empty if Redis not available
      }

      const key = `conversation:${conversationId}`;
      const data = await this.client.get(key);

      if (!data) {
        return [];
      }

      return JSON.parse(data);
    } catch (error) {
      console.error('Redis get error:', error instanceof Error ? error.message : error);
      return []; // Return empty on error
    }
  }

  async add(conversationId: string, message: Message): Promise<void> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return; // Skip if Redis not available
      }

      const key = `conversation:${conversationId}`;
      const existingData = await this.get(conversationId);

      existingData.push(message);

      await this.client.set(key, JSON.stringify(existingData), {
        EX: 60 * 60 * 24 * 7, // 7 days TTL
      });
    } catch (error) {
      console.error('Redis add error:', error instanceof Error ? error.message : error);
      // Continue without Redis
    }
  }

  async delete(conversationId: string): Promise<void> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return;
      }

      const key = `conversation:${conversationId}`;
      await this.client.del(key);
    } catch (error) {
      console.error('Redis delete error:', error instanceof Error ? error.message : error);
    }
  }

  async clear(): Promise<void> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return;
      }

      await this.client.flushDb();
    } catch (error) {
      console.error('Redis clear error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Generic get method for any key
   */
  async getKey(key: string): Promise<string | null> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return null;
      }

      return await this.client.get(key);
    } catch (error) {
      console.error('Redis getKey error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Generic set method with TTL
   */
  async setKey(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return;
      }
      
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      console.error('Redis setKey error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Generic delete method
   */
  async deleteKey(key: string): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return false;
      }
      
      const deleted = await this.client.del(key);
      return (deleted || 0) > 0;
    } catch (error) {
      console.error('Redis deleteKey error:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Check connection status
   */
  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): { isUpstash: boolean; isConnected: boolean } {
    return {
      isUpstash: this.isUpstash,
      isConnected: this.isConnected,
    };
  }
}

export const redisStore = new RedisStore();