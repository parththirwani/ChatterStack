import { z } from "zod";

const MAX_INPUT_TOKENS = 1000;
export const SUPPORTED_MODELS = ["openai/gpt-4o", "openai/gpt-5"] as const;

export type MODEL = typeof SUPPORTED_MODELS[number];

export const CreateChatSchema = z.object({
    conversationId: z.string().uuid().optional(),
    message: z.string().max(MAX_INPUT_TOKENS),
    model: z.enum(SUPPORTED_MODELS)
});

export type CreateChatInput = z.infer<typeof CreateChatSchema>;

export type Message = {
    content: string;
    role: Role;
}

export enum Role {
    Assistant = 'assistant',
    User = 'user'
}

export type Messages = Message[];