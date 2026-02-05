// backend/types.ts
import { z } from "zod";

const MAX_INPUT_TOKENS = 1000;
export const SUPPORTED_MODELS = [
  "deepseek/deepseek-chat-v3.1",
  "google/gemini-2.5-flash",
  "openai/gpt-4o",
  "anthropic/claude-sonnet-4.5",
  "x-ai/grok-2-1212"
] as const;

export type MODEL = typeof SUPPORTED_MODELS[number];

// Updated schema for single model per message
export const CreateChatSchema = z.object({
    conversationId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(MAX_INPUT_TOKENS),
    selectedModel: z.string(), // Single model instead of array
});

export type CreateChatInput = z.infer<typeof CreateChatSchema>;

export type Message = {
    content: string;
    role: Role;
    modelId?: string;
}

export enum Role {
    Assistant = 'assistant',
    User = 'user'
}

export type Messages = Message[];