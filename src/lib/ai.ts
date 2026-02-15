import { Conversation } from "../types";
import { ChatRequest } from "../types/chat.types";
export class ApiService {
  private static baseUrl = "/api";

  private static async fetchWithAuth(url: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${url}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return response;
  }

  static async sendMessage(
    request: ChatRequest,
    onChunk?: (chunk: string) => void,
    onDone?: () => void,
    onConversationId?: (id: string) => void
  ): Promise<{ conversationId?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/ai/chat`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Chat API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let conversationId: string | undefined;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                if (onDone) onDone();
                return { conversationId };
              }

              try {
                const parsed = JSON.parse(data);

                if (parsed.status === "starting") continue;
                if (parsed.error) throw new Error(parsed.error);
                if (parsed.conversationId && onConversationId) {
                  conversationId = parsed.conversationId;
                  onConversationId(parsed.conversationId);
                }
                if (parsed.chunk && onChunk) onChunk(parsed.chunk);
                if (parsed.done && onDone) onDone();
              } catch {}
            }
          }
        }
      }

      return { conversationId };
    } catch (error) {
      console.error("Send message failed:", error);
      throw error;
    }
  }

  static async getConversations(): Promise<Conversation[]> {
    try {
      const response = await this.fetchWithAuth("/ai/conversations");
      return await response.json();
    } catch (error) {
      console.error("Get conversations failed:", error);
      return [];
    }
  }

  static async getConversation(
    conversationId: string
  ): Promise<{ conversation: Conversation } | null> {
    try {
      const response = await this.fetchWithAuth(`/ai/conversations/${conversationId}`);
      return await response.json();
    } catch (error) {
      console.error("Get conversation failed:", error);
      return null;
    }
  }

  static async deleteConversation(conversationId: string): Promise<void> {
    try {
      await this.fetchWithAuth(`/ai/conversations/${conversationId}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      throw error;
    }
  }
}