import { createClient } from 'redis';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}

class RedisStore {
  private client: ReturnType<typeof createClient> | null = null;
  private isConnected = false;

  async connect() {
    if (this.isConnected) return;

    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              return new Error('Redis reconnection failed');
            }
            return retries * 100;
          },
        },
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        console.log('Redis connected');
      });

      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  async get(conversationId: string): Promise<Message[]> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    const key = `conversation:${conversationId}`;
    const data = await this.client?.get(key);

    if (!data) {
      return [];
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to parse conversation data:', error);
      return [];
    }
  }

  async add(conversationId: string, message: Message): Promise<void> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    const key = `conversation:${conversationId}`;
    const existingData = await this.get(conversationId);

    existingData.push(message);

    await this.client?.set(key, JSON.stringify(existingData), {
      EX: 60 * 60 * 24 * 7, // 7 days TTL
    });
  }

  async delete(conversationId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    const key = `conversation:${conversationId}`;
    await this.client?.del(key);
  }

  async clear(): Promise<void> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    await this.client?.flushDb();
  }
}

export const redisStore = new RedisStore();