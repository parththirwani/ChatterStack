/**
 * Shared fixtures. `mockChat` stands in for OpenRouter: /api/chat is routed to
 * a local SSE server that each test scripts, so streams can be held open and
 * timed exactly. Everything else (auth, conversations API, database) is real.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test as base, expect, type Page } from '@playwright/test';
import { deleteTestConversations, E2E_USER_ID, literal, sql } from './db';

export interface ChatBody {
  message: string;
  conversationId?: string;
  newConversation?: boolean;
  selectedModel: string;
  thinkingLevel?: string;
  council?: { members: string[]; chair: string };
  skills?: string[];
}

export interface Stream {
  body: ChatBody;
  send(event: object): void;
  /** Sends [DONE] and closes the response. */
  end(): void;
  /** Does what the real route does for a new chat: saves the row and says so. */
  createConversation(): void;
  /** Saves the exchange like the real route does once the answer is complete. */
  saveMessages(answer: string): void;
}

export type Script = (stream: Stream) => Promise<void> | void;

export interface MockChat {
  /** Queue the script for the next /api/chat request. */
  next(script: Script): void;
  readonly requests: ChatBody[];
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

export const test = base.extend<{ mockChat: MockChat; cleanDatabase: void }>({
  // Every test starts with no chats for the test user.
  cleanDatabase: [
    async ({}, provide) => {
      deleteTestConversations();
      await provide();
    },
    { auto: true },
  ],
  mockChat: async ({ page }, provide) => {
    const scripts: Script[] = [];
    const requests: ChatBody[] = [];

    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as ChatBody;
      requests.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.flushHeaders();

      const id = body.conversationId!;
      const stream: Stream = {
        body,
        send: (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
        end: () => {
          res.write('data: [DONE]\n\n');
          res.end();
        },
        createConversation: () => {
          sql(`INSERT INTO conversations (id, "userId", "createdAt", "updatedAt")
               VALUES (${literal(id)}, ${literal(E2E_USER_ID)}, now(), now())`);
          stream.send({ conversationCreated: id });
        },
        saveMessages: (answer) => {
          // The same rows the app writes: numbered after whatever the chat holds
          // already, question then answer.
          const next = (offset: number) =>
            `(SELECT coalesce(max(position), 0) + ${offset} FROM messages WHERE "conversationId" = ${literal(id)})`;
          const userMessageId = randomUUID();
          const assistantMessageId = randomUUID();
          sql(`INSERT INTO messages (id, "conversationId", content, role, "modelId", position, "createdAt", "updatedAt") VALUES
               (${literal(userMessageId)}, ${literal(id)}, ${literal(body.message)}, 'user', NULL, ${next(1)}, now(), now()),
               (${literal(assistantMessageId)}, ${literal(id)}, ${literal(answer)}, 'assistant', ${literal(body.selectedModel)}, ${next(2)}, now() + interval '1 second', now())`);
          stream.send({ savedMessages: { userMessageId, assistantMessageId } });
        },
      };

      const script = scripts.shift();
      if (!script) {
        stream.send({ error: 'No mock script queued for this request' });
        return stream.end();
      }
      await script(stream);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    await page.route('**/api/chat', (route) => route.continue({ url: `http://127.0.0.1:${port}/api/chat` }));
    await provide({ next: (script) => scripts.push(script), requests });

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  },
});

/** Opens the app with the given composer settings in localStorage. */
export async function openApp(page: Page, settings: Record<string, string> = {}, path = '/') {
  await page.goto(path);
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, settings);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
}

export async function sendMessage(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

export const sidebar = {
  pinned: (page: Page) => page.getByRole('region', { name: 'Pinned chats', exact: true }),
  chats: (page: Page) => page.getByRole('region', { name: 'Recents', exact: true }),
  titles: (page: Page, section: 'Pinned chats' | 'Recents') =>
    page.getByRole('region', { name: section, exact: true }).locator('li > div > button:first-child span:first-child'),
  row: (page: Page, title: string | RegExp) => page.locator('section li').filter({ hasText: title }),
};

export const MODELS = {
  gpt: 'openai/gpt-6.1-sol',
  gemini: 'google/gemini-4-argon',
  claude: 'anthropic/claude-sonnet-5.5',
  deepseek: 'deepseek/deepseek-v4.1-flash-1017',
} as const;

export { expect };
