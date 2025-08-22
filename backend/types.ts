import { z } from "zod";

const MAX_INPUT_TOKENS = 1000;

export const CreateChatSchema = z.object({
    message: z.string().max(MAX_INPUT_TOKENS)
})