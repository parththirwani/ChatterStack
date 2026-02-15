// src/middleware/llmTokenRateLimit.ts
// LLM Token-based 24-hour sliding window rate limiting
// - 4000 LLM tokens per 24 hours (input + output tokens)
// - 2 council messages per 24 hours (separate limit)

import { encode } from 'gpt-tokenizer';

interface TokenRecord {
  timestamp: number;
  tokens: number;
  type: 'regular' | 'council';
}

interface UserTokenStore {
  [userId: string]: TokenRecord[];
}

class LLMTokenRateLimiter {
  private store: UserTokenStore = {};
  private cleanupInterval: NodeJS.Timeout;
  
  // Configuration
  private readonly WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_LLM_TOKENS = 4000; // 4000 LLM tokens per 24 hours
  private readonly MAX_COUNCIL_MESSAGES = 2; // 2 council messages per 24 hours
  
  constructor() {
    // Clean up old records every hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    const cutoff = now - this.WINDOW_MS;
    
    for (const userId in this.store) {
      // Remove records older than 24 hours
      this.store[userId] = this.store[userId].filter(
        record => record.timestamp > cutoff
      );
      
      // Remove user if no records left
      if (this.store[userId].length === 0) {
        delete this.store[userId];
      }
    }
  }

  /**
   * Calculate LLM tokens used in the last 24 hours
   */
  private getUsedLLMTokens(userId: string): number {
    const now = Date.now();
    const cutoff = now - this.WINDOW_MS;
    
    if (!this.store[userId]) {
      return 0;
    }
    
    // Sum tokens from all records in the last 24 hours
    return this.store[userId]
      .filter(record => record.timestamp > cutoff)
      .reduce((sum, record) => sum + record.tokens, 0);
  }

  /**
   * Calculate council messages used in the last 24 hours
   */
  private getUsedCouncilMessages(userId: string): number {
    const now = Date.now();
    const cutoff = now - this.WINDOW_MS;
    
    if (!this.store[userId]) {
      return 0;
    }
    
    // Count council messages in the last 24 hours
    return this.store[userId]
      .filter(record => record.timestamp > cutoff && record.type === 'council')
      .length;
  }

  /**
   * Get the earliest timestamp when tokens/council slots will be available
   */
  private getNextAvailableTime(
    userId: string,
    tokensNeeded: number,
    isCouncil: boolean
  ): number {
    if (!this.store[userId] || this.store[userId].length === 0) {
      return Date.now();
    }
    
    const now = Date.now();
    const records = [...this.store[userId]]
      .filter(r => r.timestamp > now - this.WINDOW_MS)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (isCouncil) {
      // Find when oldest council message expires
      const councilRecords = records.filter(r => r.type === 'council');
      if (councilRecords.length < this.MAX_COUNCIL_MESSAGES) {
        return now; // Can send now
      }
      // Return when oldest council message expires
      return councilRecords[0].timestamp + this.WINDOW_MS;
    } else {
      // Find when enough LLM tokens will be available
      let accumulatedTokens = this.getUsedLLMTokens(userId);
      
      for (const record of records) {
        const expiresAt = record.timestamp + this.WINDOW_MS;
        accumulatedTokens -= record.tokens;
        
        if (this.MAX_LLM_TOKENS - accumulatedTokens >= tokensNeeded) {
          return expiresAt;
        }
      }
      
      // If we get here, return when the oldest record expires
      return records[0].timestamp + this.WINDOW_MS;
    }
  }

  /**
   * Estimate tokens in a message (input + typical output)
   */
  private estimateTokens(message: string, isCouncil: boolean): number {
    // Count input tokens
    const inputTokens = encode(message).length;
    
    // Estimate output tokens (typically 2-3x input for good responses)
    // Council mode generates longer responses
    const outputMultiplier = isCouncil ? 4 : 2.5;
    const estimatedOutputTokens = Math.ceil(inputTokens * outputMultiplier);
    
    return inputTokens + estimatedOutputTokens;
  }

  /**
   * Record actual tokens used after message completion
   */
  async recordTokens(
    userId: string,
    actualTokens: number,
    isCouncil: boolean
  ): Promise<void> {
    if (!this.store[userId]) {
      this.store[userId] = [];
    }
    
    this.store[userId].push({
      timestamp: Date.now(),
      tokens: actualTokens,
      type: isCouncil ? 'council' : 'regular',
    });
  }

  /**
   * Check if user can send a message (pre-flight check)
   */
  async checkLimit(
    userId: string,
    message: string,
    isCouncil: boolean
  ): Promise<{
    allowed: boolean;
    estimatedTokens: number;
    tokensUsed: number;
    tokensLimit: number;
    tokensRemaining: number;
    councilUsed: number;
    councilLimit: number;
    councilRemaining: number;
    resetAt: number;
    retryAfter?: number;
    message?: string;
  }> {
    const now = Date.now();
    const tokensUsed = this.getUsedLLMTokens(userId);
    const councilUsed = this.getUsedCouncilMessages(userId);
    const estimatedTokens = this.estimateTokens(message, isCouncil);
    
    const tokensRemaining = Math.max(0, this.MAX_LLM_TOKENS - tokensUsed);
    const councilRemaining = Math.max(0, this.MAX_COUNCIL_MESSAGES - councilUsed);
    
    // Calculate when the window resets
    let resetAt = now + this.WINDOW_MS;
    if (this.store[userId] && this.store[userId].length > 0) {
      const oldestRecord = this.store[userId]
        .filter(r => r.timestamp > now - this.WINDOW_MS)
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (oldestRecord) {
        resetAt = oldestRecord.timestamp + this.WINDOW_MS;
      }
    }
    
    // Check council limit first
    if (isCouncil && councilUsed >= this.MAX_COUNCIL_MESSAGES) {
      const nextAvailable = this.getNextAvailableTime(userId, 0, true);
      const retryAfterMs = nextAvailable - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      
      return {
        allowed: false,
        estimatedTokens,
        tokensUsed,
        tokensLimit: this.MAX_LLM_TOKENS,
        tokensRemaining,
        councilUsed,
        councilLimit: this.MAX_COUNCIL_MESSAGES,
        councilRemaining,
        resetAt,
        retryAfter: retryAfterSeconds,
        message: this.formatCouncilLimitMessage(retryAfterMs),
      };
    }
    
    // Check token limit
    if (tokensUsed + estimatedTokens > this.MAX_LLM_TOKENS) {
      const nextAvailable = this.getNextAvailableTime(userId, estimatedTokens, false);
      const retryAfterMs = nextAvailable - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      
      return {
        allowed: false,
        estimatedTokens,
        tokensUsed,
        tokensLimit: this.MAX_LLM_TOKENS,
        tokensRemaining,
        councilUsed,
        councilLimit: this.MAX_COUNCIL_MESSAGES,
        councilRemaining,
        resetAt,
        retryAfter: retryAfterSeconds,
        message: this.formatTokenLimitMessage(
          retryAfterMs,
          estimatedTokens,
          tokensRemaining
        ),
      };
    }
    
    return {
      allowed: true,
      estimatedTokens,
      tokensUsed,
      tokensLimit: this.MAX_LLM_TOKENS,
      tokensRemaining: tokensRemaining - estimatedTokens,
      councilUsed,
      councilLimit: this.MAX_COUNCIL_MESSAGES,
      councilRemaining: isCouncil ? councilRemaining - 1 : councilRemaining,
      resetAt,
    };
  }

  /**
   * Format user-friendly retry message for token limit
   */
  private formatTokenLimitMessage(
    retryAfterMs: number,
    tokensNeeded: number,
    tokensRemaining: number
  ): string {
    const hours = Math.floor(retryAfterMs / (60 * 60 * 1000));
    const minutes = Math.floor((retryAfterMs % (60 * 60 * 1000)) / (60 * 1000));
    
    let timeStr = '';
    if (hours > 0) {
      timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
      if (minutes > 0) {
        timeStr += ` and ${minutes} minute${minutes > 1 ? 's' : ''}`;
      }
    } else if (minutes > 0) {
      timeStr = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      timeStr = 'a few seconds';
    }
    
    return `You've used your daily token limit. This message needs ~${tokensNeeded} tokens but you only have ${tokensRemaining} remaining. More tokens available in ${timeStr}.`;
  }

  /**
   * Format user-friendly retry message for council limit
   */
  private formatCouncilLimitMessage(retryAfterMs: number): string {
    const hours = Math.floor(retryAfterMs / (60 * 60 * 1000));
    const minutes = Math.floor((retryAfterMs % (60 * 60 * 1000)) / (60 * 1000));
    
    let timeStr = '';
    if (hours > 0) {
      timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
      if (minutes > 0) {
        timeStr += ` and ${minutes} minute${minutes > 1 ? 's' : ''}`;
      }
    } else if (minutes > 0) {
      timeStr = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      timeStr = 'a few seconds';
    }
    
    return `You've reached your daily limit of 2 council messages. You can send another council message in ${timeStr}.`;
  }

  /**
   * Get current status for a user
   */
  async getStatus(userId: string): Promise<{
    tokensUsed: number;
    tokensLimit: number;
    tokensRemaining: number;
    councilUsed: number;
    councilLimit: number;
    councilRemaining: number;
    resetAt: number;
    canSendRegular: boolean;
    canSendCouncil: boolean;
  }> {
    const now = Date.now();
    const tokensUsed = this.getUsedLLMTokens(userId);
    const councilUsed = this.getUsedCouncilMessages(userId);
    const tokensRemaining = Math.max(0, this.MAX_LLM_TOKENS - tokensUsed);
    const councilRemaining = Math.max(0, this.MAX_COUNCIL_MESSAGES - councilUsed);
    
    let resetAt = now + this.WINDOW_MS;
    if (this.store[userId] && this.store[userId].length > 0) {
      const oldestRecord = this.store[userId]
        .filter(r => r.timestamp > now - this.WINDOW_MS)
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (oldestRecord) {
        resetAt = oldestRecord.timestamp + this.WINDOW_MS;
      }
    }
    
    // Estimate: can send regular if we have at least 100 tokens
    // (minimum for a basic message)
    const canSendRegular = tokensRemaining >= 100;
    const canSendCouncil = councilRemaining > 0 && tokensRemaining >= 500;
    
    return {
      tokensUsed,
      tokensLimit: this.MAX_LLM_TOKENS,
      tokensRemaining,
      councilUsed,
      councilLimit: this.MAX_COUNCIL_MESSAGES,
      councilRemaining,
      resetAt,
      canSendRegular,
      canSendCouncil,
    };
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

// Singleton instance
const llmTokenRateLimiter = new LLMTokenRateLimiter();

/**
 * Check if user can send a message (before sending)
 */
export async function checkLLMTokenLimit(
  userId: string,
  message: string,
  isCouncil: boolean
) {
  return llmTokenRateLimiter.checkLimit(userId, message, isCouncil);
}

/**
 * Record actual tokens used (after response completes)
 */
export async function recordLLMTokens(
  userId: string,
  actualTokens: number,
  isCouncil: boolean
): Promise<void> {
  return llmTokenRateLimiter.recordTokens(userId, actualTokens, isCouncil);
}

/**
 * Get user's current rate limit status
 */
export async function getLLMTokenStatus(userId: string) {
  return llmTokenRateLimiter.getStatus(userId);
}

/**
 * Middleware for chat routes
 */
export async function withLLMTokenLimit(
  userId: string,
  message: string,
  isCouncil: boolean
): Promise<Response | null> {
  const result = await checkLLMTokenLimit(userId, message, isCouncil);

  if (!result.allowed) {
    const resetDate = new Date(result.resetAt);
    
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: result.message,
        details: {
          estimatedTokens: result.estimatedTokens,
          tokensUsed: result.tokensUsed,
          tokensLimit: result.tokensLimit,
          tokensRemaining: result.tokensRemaining,
          councilUsed: result.councilUsed,
          councilLimit: result.councilLimit,
          councilRemaining: result.councilRemaining,
          resetAt: result.resetAt,
          resetTime: resetDate.toISOString(),
          retryAfter: result.retryAfter,
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-LLM-Tokens-Limit': result.tokensLimit.toString(),
          'X-RateLimit-LLM-Tokens-Remaining': result.tokensRemaining.toString(),
          'X-RateLimit-Council-Limit': result.councilLimit.toString(),
          'X-RateLimit-Council-Remaining': result.councilRemaining.toString(),
          'X-RateLimit-Reset': result.resetAt.toString(),
          'Retry-After': (result.retryAfter || 0).toString(),
        },
      }
    );
  }

  return null; // Success - continue
}

/**
 * Count tokens in text (for calculating actual usage)
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

export default llmTokenRateLimiter;