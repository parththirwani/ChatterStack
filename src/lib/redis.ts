import { createClient } from 'redis';

interface Message {
  /** The saved Message row id, used as a stable compaction boundary. */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  attachments?: Array<import('@/src/types/chat.types').DocumentAttachment | import('@/src/types/chat.types').ChatAttachment>;
  createdAt?: string;
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
      } else if (localRedisUrl) {
        // Fall back to local Redis
        redisUrl = localRedisUrl;
        this.isUpstash = false;
      } else {
        console.warn('⚠️  No Redis configuration found - Redis features disabled');
        return; // Don't throw, just disable Redis features
      }

      // For Upstash, convert https:// URL to rediss:// format
      if (this.isUpstash && redisUrl) {
        // Upstash URLs come as https://xxx.upstash.io
        // We need rediss://default:token@xxx.upstash.io:6379
        const urlObj = new URL(redisUrl);
        redisUrl = `rediss://default:${redisToken}@${urlObj.hostname}:6379`;
        
        
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
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
      });

      await this.client.connect();

      // Test connection
      await this.client.ping();

    } catch (error) {
      console.error('⚠️  Redis connection failed:', error instanceof Error ? error.message : error);
      this.isConnected = false;
      this.client = null;
      // Allow a later call to retry the connection (e.g. after a transient
      // outage); without this one failed attempt would disable Redis forever.
      this.connectionAttempted = false;
      // Don't throw - let the app work without Redis
    }
  }

  /**
   * Runs a Lua script atomically on the server (EVAL with KEYS/ARGV).
   * Unlike the other methods this one throws when Redis is not configured,
   * connected, or the script fails - callers that can degrade (e.g. the
   * rate limiter) decide what to do with the error.
   */
  async evalScript(
    script: string,
    options: { keys: string[]; arguments: Array<string | number> }
  ): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }
    if (!this.client || !this.isConnected) {
      throw new Error('Redis is not available');
    }
    try {
      return await this.client.eval(script, {
        keys: options.keys,
        arguments: options.arguments.map(String),
      });
    } catch (error) {
      // Treat script errors that indicate a lost connection as outages.
      this.isConnected = this.client.isReady;
      throw error;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        this.isConnected = false;
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

  /** Replace a conversation's cached history in one write (e.g. after a cache miss). */
  async set(conversationId: string, messages: Message[]): Promise<void> {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }

      if (!this.client || !this.isConnected) {
        return;
      }

      await this.client.set(`conversation:${conversationId}`, JSON.stringify(messages), {
        EX: 60 * 60 * 24 * 7, // 7 days TTL
      });
    } catch (error) {
      console.error('Redis set error:', error instanceof Error ? error.message : error);
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
