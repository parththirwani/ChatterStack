import { createClient, RedisClientType } from 'redis'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  modelId?: string
}

const EVICTION_TIME = 5 * 60 // 5 minutes in seconds
const MAX_MESSAGES_PER_CONVERSATION = 100

export class RedisStore {
  private static instance: RedisStore
  private client: RedisClientType
  private isConnected: boolean = false

  private constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Redis: Too many reconnection attempts')
            return new Error('Too many reconnection attempts')
          }
          return Math.min(retries * 50, 2000)
        },
      },
    })

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err)
      this.isConnected = false
    })

    this.client.on('connect', () => {
      console.log('Redis: Connected')
      this.isConnected = true
    })

    this.client.on('ready', () => {
      console.log('Redis: Ready to accept commands')
    })

    this.client.on('reconnecting', () => {
      console.log('Redis: Reconnecting...')
    })

    this.client.on('end', () => {
      console.log('Redis: Connection closed')
      this.isConnected = false
    })
  }

  static getInstance(): RedisStore {
    if (!RedisStore.instance) {
      RedisStore.instance = new RedisStore()
    }
    return RedisStore.instance
  }

  async connect(): Promise<void> {
    if (!this.isConnected && !this.client.isOpen) {
      await this.client.connect()
    }
  }

  isReady(): boolean {
    return this.isConnected && this.client.isOpen
  }

  async getKey(key: string): Promise<string | null> {
    if (!this.isReady()) {
      await this.connect()
    }
    return await this.client.get(key)
  }

  async setKey(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.isReady()) {
      await this.connect()
    }

    if (ttl) {
      await this.client.setEx(key, ttl, value)
    } else {
      await this.client.set(key, value)
    }
  }

  async deleteKey(key: string): Promise<boolean> {
    if (!this.isReady()) {
      await this.connect()
    }

    const deleted = await this.client.del(key)
    return deleted > 0
  }

  async add(conversationId: string, message: Message): Promise<void> {
    if (!this.isReady()) {
      await this.connect()
    }

    const key = this.getConversationKey(conversationId)
    const existing = await this.client.get(key)
    const messages: Message[] = existing ? JSON.parse(existing) : []

    messages.push(message)

    if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      messages.shift()
    }

    await this.client.setEx(key, EVICTION_TIME, JSON.stringify(messages))
  }

  async get(conversationId: string): Promise<Message[]> {
    if (!this.isReady()) {
      await this.connect()
    }

    const key = this.getConversationKey(conversationId)
    const data = await this.client.get(key)

    if (!data) {
      return []
    }

    await this.client.expire(key, EVICTION_TIME)
    return JSON.parse(data) as Message[]
  }

  async delete(conversationId: string): Promise<boolean> {
    if (!this.isReady()) {
      await this.connect()
    }

    const key = this.getConversationKey(conversationId)
    const deleted = await this.client.del(key)
    return deleted > 0
  }

  async destroy(): Promise<void> {
    if (this.isConnected && this.client.isOpen) {
      await this.client.quit()
      this.isConnected = false
    }
  }

  getClient(): RedisClientType {
    if (!this.isConnected || !this.client.isOpen) {
      throw new Error('Redis client is not connected')
    }
    return this.client
  }

  private getConversationKey(conversationId: string): string {
    return `conversation:${conversationId}`
  }
}