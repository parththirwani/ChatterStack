# Fork a chat from a message

## Goal and behavior

Add **Fork in new chat** to the actions for each saved user or assistant message. Clicking it creates a separate conversation containing the source conversation's saved messages from the beginning through the selected message, inclusive. Open the new conversation at `/<newConversationId>` with the composer ready. The source stays unchanged. Later messages and new replies in either conversation do not appear in the other.

This follows ChatGPT's documented web interaction: hover a message, open More actions (`…`), then choose "Branch in new chat." OpenAI also says the original thread remains available. This is the interaction reference, not a claim about ChatGPT's storage design. Sources: [ChatGPT release notes, September 4, 2025](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) and [Projects in ChatGPT, Branch a chat](https://help.openai.com/en/articles/10169521-projects-in-chatgpt).

### Product decisions

- Offer the action for both roles. A fork from a user message ends with that user message and does **not** automatically generate an answer. The next submitted prompt is appended normally. A fork from an assistant message includes its answer.
- Show the action for persisted messages with UUIDs. Do not offer it for local placeholder IDs or a reply that is still streaming. Earlier saved messages remain forkable while a later reply streams.
- Give the fork a title such as `Fork of <source title>`, capped at the existing 80 character title limit. Start it unpinned. Keep the source title and activity timestamp unchanged.
- Copy message content, role, model ID, attachment references, and skill tags. Generate new message IDs. The new conversation has its own URL and draft. Its copy is a snapshot; edits, retries, and deletion in either chat do not rewrite the other.
- Keep a small origin record (`parentConversationId`, `forkedFromMessageId`) for future navigation and support. A deleted source must not delete its forks. The first release need not show a branch tree or a link back to the source.
- This is for signed-in, ordinary chats. Exclude scheduled-task run chats for the first release because they are listed and managed separately.

## Relevant code today

| Area | Current behavior | Change needed |
| --- | --- | --- |
| `prisma/schema.prisma` | `Conversation` has many `Message` rows; `Message` stores content, role, model ID, attachments, and skills. | Add nullable origin fields and a migration. Copy message rows into a new conversation. |
| `src/lib/server/conversations.ts` | `getConversation` serializes the full message history; list queries include only the first message. | Return origin fields if exposed to the client. Use the existing serializer for the fork response. |
| `src/app/api/conversations/[id]/route.ts` | Authenticated read, rename, pin, and delete operations check ownership. | Add a dedicated `POST /api/conversations/[id]/fork` route with the same ownership rule. |
| `src/components/chat/interface/ChatInterface.tsx` | `MessageList` renders user and assistant messages; saved rows have `msg.id`. | Pass the selected ID and a fork callback to the action UI. |
| `src/components/chat/messages/*` and `src/components/chat/actions/MessageActions.tsx` | Assistant replies have copy, download, and retry actions; user bubbles have no action row. | Add an accessible More actions menu for both roles, containing Fork in new chat. Keep existing actions. |
| `src/components/pages/ChatPage.tsx`, `src/lib/navigation.ts` | `showConversation` updates the URL and the page loads chat data into Zustand. | After fork succeeds, hydrate the returned conversation, set its ID, and call `showConversation(newId)`. |
| `src/store/slices/conversations/conversationSlice.ts`, `src/services/api.ts` | The store caches conversations and messages; the API service caches reads. | Add `forkConversation`, invalidate the list cache, and insert the returned fork into the store without clobbering active streams. |
| `src/app/api/chat/route.ts`, `src/lib/redis.ts` | The next model request reads history from Redis or Postgres. | Do not reuse the parent's Redis key. Let the fork's first send load its copied history from Postgres. |

## Implementation steps

1. **Schema.** Add nullable `parentConversationId` and `forkedFromMessageId` scalar fields to `Conversation`, plus an index on `parentConversationId`. Do not add cascading relations to the source, since forks must survive source deletion. Add a `position` integer to `Message`, unique per conversation. Backfill existing positions in the migration with `row_number()` partitioned by `conversationId`, ordered by `createdAt, id`, then make the field required and add `@@unique([conversationId, position])`. Generate and commit the migration. Add origin fields to the shared `Conversation` type and serializer only if the client needs them for display or diagnostics.

2. **Fork service and route.** Add `POST /api/conversations/[id]/fork` with a strict body `{ "messageId": "<UUID>" }`. Require a session. Validate both IDs, then read the source using `{ id, userId, scheduledTaskId: null }`. Find the selected saved message *within that source*. Return `401` for no session, `400` for malformed input, `404` for an inaccessible source or message, and a safe `500` for failure. Do not reveal whether another user's IDs exist. Read the ordered prefix and create the new conversation and copied messages in one Prisma transaction. Return `201` with the serialized conversation, including the new ID and copied messages. A failed transaction must leave no empty fork.

3. **History ordering.** Use `position` for source selection, copying, display, and model history. The current code orders by `createdAt` alone in `getConversation` and `readMessages`; that is insufficient if two rows share a timestamp. Copy each selected message's position and original timestamps into the new conversation. Audit every message writer, including ordinary chat, retries, and scheduled task runs. Assign positions to newly saved exchanges inside the same transaction as their inserts, after the current maximum. Serialize `position` on `Message`; update `getConversation`, `/api/chat` history reads, and client sorting to use it. A retry should replace its last exchange without leaving duplicate positions. Include the selected row exactly once, and exclude every later row.

4. **Client API and state.** Add a typed API method for the route. When it returns, invalidate the conversation list cache, hydrate the returned fork into the chat store, add it to Recents, set it active, and call `showConversation(newId)`. Do not create a client-only fork before the server confirms it; the database result is the source of truth. Leave the source's in-flight generation and draft untouched. Show a short error notice on failure and keep the user in the source chat. Disable only the clicked menu item while the request runs to prevent accidental duplicate clicks.

5. **Message actions.** Give each saved user and assistant message an accessible More actions button. Put **Fork in new chat** in its menu. Support pointer, keyboard focus, Enter/Space, and Escape; restore focus when closing the menu. Hide or disable the action when `msg.id` is a local ID. Keep copy, download, and retry behavior. On touch, the menu button must be visible without hover. Do not include a fork button in the sidebar conversation menu, because the user must choose a message boundary.

6. **Data references and ancillary systems.** Copy attachment `documentId` references and skill tag snapshots, not binary files or skill records. The existing serializer and attachment reader already handle deleted documents and skills; verify the fork shows the same removed state. Do not duplicate Qdrant embeddings or update the user profile merely because a fork was created. The copied Postgres rows supply the prompt history on the fork's first send. Do not copy the parent's Redis history, since it may include messages after the selected point.

7. **Checks.** Add focused service or route integration tests, component tests for the menu, and one browser test for the full flow. Run `npm run test:static`, the relevant Vitest projects, and the fork browser test. Inspect the migration and final diff for generated files and secrets before committing. Follow `AGENTS.md`: implement on a fresh `feature/` branch from `origin/dev`, commit and push checkpoints, and share the feature for review before opening its PR against `dev`.

## Acceptance cases

- Forking an assistant reply copies every saved message through that reply. Forking the preceding user message excludes the reply. Both forks appear in Recents, open at their own URLs, and accept new prompts using the copied history.
- Reloading either fork shows the same prefix. A new answer, retry, rename, pin, or deletion in one conversation does not alter the other. Deleting the source leaves the fork usable.
- An unauthenticated request fails. A user cannot fork another user's chat or use a message ID from a different conversation. Malformed and missing IDs do not create a conversation.
- A database failure leaves no partial conversation. Double-clicks from one menu action issue one request. A fork action on an unsaved or streaming message is unavailable.
- The copied history preserves attachments, skill tags, model labels, and message order. A deleted attachment remains visibly unavailable, and it is not silently reused as a live file.
- Forking an older saved message while a later reply streams does not stop or move that stream. The fork excludes the later reply, and the source completes normally.

## Limits to check before shipping

- A fork of a long conversation duplicates its saved message rows and may exceed the model's token limit on the next prompt. The existing chat request limit should still report this cleanly; fork creation itself should not call a model.
- The current per-conversation turn queue in `src/lib/api/chat/conversation-turns.ts` is in-process. The fork route must take a committed snapshot of the selected prefix; do not read optimistic client messages or assume an in-flight turn has already saved.
- RAG retrieval excludes the current conversation ID. A fork gets a new ID, so its source conversation may appear in user-level retrieval results. Verify that this does not insert duplicate short-term context into the next answer; adjust retrieval if it does.
