// Extract: Conversation storage methods
import { RedisClient } from './client';

export class ConversationStore {
  constructor(private client: RedisClient) {}
  
  async get(conversationId: string): Promise<Message[]> {
    const key = `conversation:${conversationId}`;
    const data = await this.client.getClient().get(key);
    return data ? JSON.parse(data) : [];
  }
  
  async add(conversationId: string, message: Message): Promise<void> {
    const key = `conversation:${conversationId}`;
    const existing = await this.get(conversationId);
    existing.push(message);
    await this.client.getClient().set(key, JSON.stringify(existing), {
      EX: 60 * 60 * 24 * 7,
    });
  }
  
  async delete(conversationId: string): Promise<void> {
    const key = `conversation:${conversationId}`;
    await this.client.getClient().del(key);
  }
}