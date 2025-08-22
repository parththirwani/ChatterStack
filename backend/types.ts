import { z } from "zod";

const MAX_INPUT_TOKENS = 1000;

export const CreateChatSchema = z.object({
    conversationId: z.uuid().optional(),
    message: z.string().max(MAX_INPUT_TOKENS)
})

export type Message = {
    content: string;
    role: Role;
}[]

export type Role = "agent" | "user";