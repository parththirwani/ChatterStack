// src/lib/optimistic-chat-manager.ts
import { nanoid } from 'nanoid';
import type { Conversation } from '@/src/types/conversation.types';
import type { Message } from '@/src/types/chat.types';

export interface OptimisticChat {
  id: string;
  tempId: string; // Client-generated ID
  realId?: string; // Server ID once created
  title: string;
  userId: string;
  messages: Message[];
  status: 'generating' | 'streaming' | 'complete' | 'error';
  error?: string;
  createdAt: string;
  updatedAt: string;
  isOptimistic: true;
}

export class OptimisticChatManager {
  private optimisticChats = new Map<string, OptimisticChat>();
  private tempIdToRealId = new Map<string, string>();

  /**
   * Create an optimistic chat entry for a new conversation
   */
  createOptimisticChat(params: {
    userId: string;
    firstMessage: string;
  }): OptimisticChat {
    const tempId = `temp_${nanoid()}`;
    const now = new Date().toISOString();

    const optimisticChat: OptimisticChat = {
      id: tempId,
      tempId,
      title: this.generatePreviewTitle(params.firstMessage),
      userId: params.userId,
      messages: [
        {
          role: 'user',
          content: params.firstMessage,
          createdAt: now,
        },
      ],
      status: 'generating',
      createdAt: now,
      updatedAt: now,
      isOptimistic: true,
    };

    this.optimisticChats.set(tempId, optimisticChat);
    return optimisticChat;
  }

  /**
   * Update optimistic chat when real ID is received
   */
  linkRealId(tempId: string, realId: string): void {
    const optimistic = this.optimisticChats.get(tempId);
    if (optimistic) {
      optimistic.realId = realId;
      this.tempIdToRealId.set(tempId, realId);
      
      // Also map by real ID for easier lookup
      this.optimisticChats.set(realId, optimistic);
    }
  }

  /**
   * Update streaming status
   */
  updateStreamingStatus(
    chatId: string,
    status: OptimisticChat['status'],
    error?: string
  ): void {
    const chat = this.getChat(chatId);
    if (chat) {
      chat.status = status;
      chat.error = error;
      chat.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Add assistant message chunk
   */
  appendAssistantChunk(chatId: string, chunk: string): void {
    const chat = this.getChat(chatId);
    if (!chat) return;

    const lastMessage = chat.messages[chat.messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content += chunk;
    } else {
      chat.messages.push({
        role: 'assistant',
        content: chunk,
        createdAt: new Date().toISOString(),
      });
    }
    
    chat.updatedAt = new Date().toISOString();
  }

  /**
   * Get optimistic chat by temp or real ID
   */
  getChat(chatId: string): OptimisticChat | undefined {
    // Try direct lookup
    const chat = this.optimisticChats.get(chatId);
    if (chat) return chat;

    // Try reverse lookup (real ID → temp ID)
    for (const [tempId, realId] of this.tempIdToRealId.entries()) {
      if (realId === chatId) {
        return this.optimisticChats.get(tempId);
      }
    }

    return undefined;
  }

  /**
   * Convert optimistic chat to real conversation
   */
  finalizeChat(chatId: string, realConversation: Conversation): void {
    const optimistic = this.getChat(chatId);
    if (!optimistic) return;

    // Update with real data
    optimistic.status = 'complete';
    optimistic.title = realConversation.title || optimistic.title;
    optimistic.updatedAt = realConversation.updatedAt;
    
    // IMPORTANT: Keep the optimistic chat in the map temporarily
    // so it can be found during the transition period
    // It will be cleaned up next time getAllOptimisticChats filters
    this.optimisticChats.set(optimistic.tempId, {
      ...optimistic,
      status: 'complete'
    });
  }

  /**
   * Remove optimistic chat (on error or cancel)
   */
  removeChat(chatId: string): void {
    const chat = this.getChat(chatId);
    if (!chat) return;

    this.optimisticChats.delete(chat.tempId);
    if (chat.realId) {
      this.optimisticChats.delete(chat.realId);
      this.tempIdToRealId.delete(chat.tempId);
    }
  }

  /**
   * Get all optimistic chats for sidebar display
   */
  getAllOptimisticChats(): OptimisticChat[] {
    const chats: OptimisticChat[] = [];
    const seen = new Set<string>();

    for (const chat of this.optimisticChats.values()) {
      // Avoid duplicates (temp and real ID point to same chat)
      if (!seen.has(chat.tempId)) {
        // Only include chats that are still in progress or recently completed
        // Filter out completed chats that have been finalized
        if (chat.status !== 'complete' || !chat.realId) {
          chats.push(chat);
        }
        seen.add(chat.tempId);
      }
    }

    return chats.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Remove completed optimistic chats that have been finalized
   */
  cleanupCompleted(): void {
    for (const [key, chat] of this.optimisticChats.entries()) {
      if (chat.status === 'complete' && chat.realId) {
        this.optimisticChats.delete(key);
        this.tempIdToRealId.delete(chat.tempId);
      }
    }
  }

  /**
   * Clear all optimistic chats
   */
  clear(): void {
    this.optimisticChats.clear();
    this.tempIdToRealId.clear();
  }

  /**
   * Generate a preview title from the first message
   */
  private generatePreviewTitle(message: string): string {
    const preview = message.trim().substring(0, 50);
    return preview.length < message.trim().length ? `${preview}...` : preview;
  }
}

// Singleton instance
export const optimisticChatManager = new OptimisticChatManager();