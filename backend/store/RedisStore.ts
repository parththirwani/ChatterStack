import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import type { Message } from "../types";

const EVICTION_TIME = 5 * 60; // 5 minutes in seconds (Redis uses seconds for TTL)
const MAX_MESSAGES_PER_CONVERSATION = 100; // Optional: limit messages per conversation

export class RedisStore {
  private static instance: RedisStore;
  private client: RedisClientType;
  private isConnected: boolean = false;

  private constructor() {
    // Create Redis client with connection options
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Redis: Too many reconnection attempts');
            return new Error('Too many reconnection attempts');
          }
          // Exponential backoff: 50ms, 100ms, 200ms, etc.
          return Math.min(retries * 50, 2000);
        }
      }
    });

    // Set up event listeners
    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      console.log('Redis: Connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      console.log('Redis: Ready to accept commands');
    });

    this.client.on('reconnecting', () => {
      console.log('Redis: Reconnecting...');
    });

    this.client.on('end', () => {
      console.log('Redis: Connection closed');
      this.isConnected = false;
    });
  }

  static getInstance(): RedisStore {
    if (!RedisStore.instance) {
      RedisStore.instance = new RedisStore();
    }
    return RedisStore.instance;
  }

  /**
   * Public getter for Redis client - USE WITH CAUTION
   * Prefer using the built-in methods when possible
   */
  public getClient(): RedisClientType {
    if (!this.isConnected || !this.client.isOpen) {
      throw new Error('Redis client is not connected');
    }
    return this.client;
  }

  /**
   * Connect to Redis - must be called before using the store
   */
  async connect(): Promise<void> {
    if (!this.isConnected && !this.client.isOpen) {
      await this.client.connect();
    }
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected && this.client.isOpen;
  }

  /**
   * Generic get method for any key
   */
  async getKey(key: string): Promise<string | null> {
    if (!this.isReady()) {
      throw new Error('Redis is not connected');
    }
    return await this.client.get(key);
  }

  /**
   * Generic set method with TTL
   */
  async setKey(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.isReady()) {
      throw new Error('Redis is not connected');
    }
    
    if (ttl) {
      await this.client.setEx(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * Generic delete method
   */
  async deleteKey(key: string): Promise<boolean> {
    if (!this.isReady()) {
      throw new Error('Redis is not connected');
    }
    
    const deleted = await this.client.del(key);
    return deleted > 0;
  }

  /**
   * Add a message to a conversation
   * Automatically sets/refreshes TTL for the conversation
   */
  async add(conversationId: string, message: Message): Promise<void> {
    try {
      if (!this.isReady()) {
        throw new Error('Redis is not connected');
      }

      const key = this.getConversationKey(conversationId);
      
      // Get existing messages
      const existing = await this.client.get(key);
      const messages: Message[] = existing ? JSON.parse(existing) : [];
      
      // Add new message
      messages.push(message);
      
      // Optional: Trim to max messages (keeps most recent)
      if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
        messages.shift(); // Remove oldest message
      }
      
      // Store with TTL (this also refreshes the TTL)
      await this.client.setEx(
        key,
        EVICTION_TIME,
        JSON.stringify(messages)
      );
      
      console.log(`Added message to conversation: ${conversationId} (${messages.length} messages)`);
    } catch (error) {
      console.error('Error adding message to Redis:', error);
      throw error;
    }
  }

  /**
   * Get all messages for a conversation
   */
  async get(conversationId: string): Promise<Message[]> {
    try {
      if (!this.isReady()) {
        throw new Error('Redis is not connected');
        // Or return empty array: return [];
      }

      const key = this.getConversationKey(conversationId);
      const data = await this.client.get(key);
      
      if (!data) {
        return [];
      }
      
      // Refresh TTL on read
      await this.client.expire(key, EVICTION_TIME);
      
      return JSON.parse(data) as Message[];
    } catch (error) {
      console.error('Error getting messages from Redis:', error);
      throw error;
    }
  }

  /**
   * Delete a conversation
   */
  async delete(conversationId: string): Promise<boolean> {
    try {
      if (!this.isReady()) {
        throw new Error('Redis is not connected');
      }

      const key = this.getConversationKey(conversationId);
      const deleted = await this.client.del(key);
      console.log(`Deleted conversation: ${conversationId}`);
      return deleted > 0;
    } catch (error) {
      console.error('Error deleting conversation from Redis:', error);
      throw error;
    }
  }

  /**
   * Check if a conversation exists
   */
  async exists(conversationId: string): Promise<boolean> {
    try {
      if (!this.isReady()) {
        return false;
      }

      const key = this.getConversationKey(conversationId);
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('Error checking conversation existence in Redis:', error);
      return false;
    }
  }

  /**
   * Get all conversation IDs (useful for debugging/monitoring)
   * WARNING: Use with caution in production as KEYS command can be slow
   */
  async getAllConversationIds(): Promise<string[]> {
    try {
      if (!this.isReady()) {
        return [];
      }

      const keys = await this.client.keys('conversation:*');
      return keys.map(key => key.replace('conversation:', ''));
    } catch (error) {
      console.error('Error getting conversation IDs from Redis:', error);
      throw error;
    }
  }

  /**
   * Get TTL for a conversation (in seconds)
   * Returns -1 if key exists but has no TTL
   * Returns -2 if key doesn't exist
   */
  async getTTL(conversationId: string): Promise<number> {
    try {
      if (!this.isReady()) {
        return -2;
      }

      const key = this.getConversationKey(conversationId);
      return await this.client.ttl(key);
    } catch (error) {
      console.error('Error getting TTL from Redis:', error);
      throw error;
    }
  }

  /**
   * Get statistics about stored conversations
   */
  async getStats(): Promise<{
    totalConversations: number;
    memoryUsed?: string;
  }> {
    try {
      if (!this.isReady()) {
        return { totalConversations: 0 };
      }

      const keys = await this.client.keys('conversation:*');
      const info = await this.client.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      
      return {
        totalConversations: keys.length,
        memoryUsed: memoryMatch ? memoryMatch[1] : undefined
      };
    } catch (error) {
      console.error('Error getting Redis stats:', error);
      return { totalConversations: 0 };
    }
  }

  /**
   * Flush all conversations (use with caution!)
   */
  async flushAll(): Promise<void> {
    try {
      if (!this.isReady()) {
        throw new Error('Redis is not connected');
      }

      const keys = await this.client.keys('conversation:*');
      if (keys.length > 0) {
        await this.client.del(keys);
        console.log(`Flushed ${keys.length} conversations`);
      }
    } catch (error) {
      console.error('Error flushing conversations from Redis:', error);
      throw error;
    }
  }

  /**
   * Close Redis connection gracefully
   */
  async destroy(): Promise<void> {
    try {
      if (this.isConnected && this.client.isOpen) {
        await this.client.quit();
        this.isConnected = false;
        console.log('Redis: Connection closed gracefully');
      }
    } catch (error) {
      console.error('Error closing Redis connection:', error);
      // Force disconnect if quit fails
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  /**
   * Generate Redis key for a conversation
   */
  private getConversationKey(conversationId: string): string {
    return `conversation:${conversationId}`;
  }
}