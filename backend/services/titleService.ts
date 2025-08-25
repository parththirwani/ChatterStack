import { createCompletion } from "openrouter";
import { prisma } from "../lib/prisma";
import { Role } from "../types";

export class TitleService {
    static async generateTitle(
        conversationId: string,
        model = "gpt-3.5-turbo"
    ): Promise<string> {
        try {
            const conversation = await prisma.conversation.findUnique({
                where: { id: conversationId },
                include: {
                    messages: {
                        orderBy: { createdAt: "asc" },
                        take: 2,
                    },
                },
            });

            if (!conversation || !conversation.messages.length) {
                return "New Chat";
            }

            const textSample = conversation.messages
                .map((m) => `${m.role}: ${m.content}`)
                .join("\n");

            let summary = "";
            await createCompletion(
                [
                    {
                        role: Role.Assistant,
                        content: `You are ChatGPT’s title generator.  
                        Generate a concise title from the conversation below.  
                        Rules:  
                        - Title must be 1 to 4 plain words.  
                        - Use only words, no punctuation, no numbers, no symbols, no filler like “chat” or “conversation”.  
                        - Always output a title. Do not output “New Chat” unless the input is literally empty or meaningless.  
                        - If unsure, guess a reasonable topic from the text.  
                        - Output only the title, nothing else.
                        `,
                    },
                    { role: Role.User, content: textSample },
                ],
                model,
                (chunk: string) => {
                    summary += chunk;
                }
            );

            let title = summary.trim().replace(/[^a-zA-Z0-9\s]/g, "").trim();
            const words = title.split(/\s+/).filter(Boolean);

            if (words.length === 0) {
                title = "New Chat";
            } else if (words.length > 4) {
                title = words.slice(0, 4).join(" ");
            } else {
                title = words.join(" ");
            }

            await prisma.conversation.update({
                where: { id: conversationId },
                data: { title },
            });

            return title;
        } catch {
            return "New Chat";
        }
    }
}
