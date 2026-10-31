# MCP support plan and implementation prompt

## Goal and current state

Let each ChatterStack user connect remote MCP servers and use selected server tools in a normal chat. Offer a small catalog of prefilled connections. A catalog entry is a setup shortcut, not an automatically authorized connection.

ChatterStack currently sends text completions through OpenRouter in `src/lib/api/chat/openrouter.ts`. Its stream parser collects `content` and `reasoning`, but not `tool_calls`. `src/app/api/chat/route.ts` makes one model call per normal turn and saves a user/assistant pair. The `Message` model has no tool event representation. Council, scheduled tasks, context compaction, retry, fork, Redis history, and token accounting all assume text turns. The Skills plan explicitly notes that tool calling is absent. MCP support therefore starts with a bounded model/tool loop, not with a settings form alone.

## Product scope for the first release

- Support remote MCP over Streamable HTTP from the Next.js server. Do not run arbitrary user supplied `stdio` commands in the web deployment. Keep legacy SSE and MCP resources, prompts, apps, and elicitation for later work.
- Support a custom HTTPS endpoint and catalog entries. Start with Cloudflare documentation, GitHub read only, and Linear read only. The latter two need the user's own authorization. Validate each catalog endpoint and its authentication path in an integration environment before showing it as ready.
- Use tools in single model chats. Keep Council and scheduled tasks tool free in the first release, with an explicit UI explanation. This avoids silently giving several models or unattended runs access to external services.
- Let users enable or disable a connection and individual tools. Show server name, tool name, description, and whether the server declares a tool read only. Treat annotations as hints, not proof of safety.
- Ask for approval before each tool call in the first release, showing the server, tool, and arguments. A denied call returns a visible denial result to the model. No automatic write approval. The user can stop the turn while approval is pending.
- Show tool calls and results in the chat transcript. Save enough structured data to replay a conversation, including call id, server/tool identity, arguments, status, bounded result, and approval outcome. Never save bearer tokens in messages or logs.

## Design

### Connections and credentials

Add a user owned `McpConnection` model with id, name, catalog id or custom source, URL, enabled state, auth mode, encrypted credential reference/material, connection status, last successful check, and timestamps. Store tool enablement as a separate relation or a validated JSON map keyed by a stable server/tool identifier. Scope every API query by session user id. Deleting a user must delete connections and credentials.

Implement a dedicated server side MCP client service. It owns connection setup, `listTools`, `callTool`, abort, timeouts, error normalization, and cleanup. Use the maintained official TypeScript SDK version that supports the target protocol revisions. Check current SDK support before locking a dependency; do not hand code protocol framing. Server tool definitions are untrusted input. Normalize tool names into unique OpenRouter function names, keep a reverse map for execution, cap tool count and schema size, and reject unsupported or oversized JSON Schemas with a visible connection error.

The credential plan has two milestones. First support user supplied bearer tokens, encrypted at rest with an application key that is separate from `AUTH_SECRET`. Never return raw credentials in GET responses. Then add MCP OAuth with authorization server discovery, PKCE, state, redirect and token refresh, per user token isolation, and an explicit disconnect/revoke flow. GitHub and Linear catalog entries may be offered with a "Connect token" path in the first milestone; add one click OAuth only after the OAuth milestone works. Do not claim an unauthenticated catalog entry is ready to use.

For user supplied URLs, require HTTPS, reject credentials in URLs, loopback, link local and private address ranges, and recheck resolved addresses on every connection and redirect. Block redirects to a different origin unless explicitly validated. Enforce host and port policy, short connect and call deadlines, response size limits, and a per user connection quota. Route all MCP traffic through the server; never expose credentials to the browser or OpenRouter. Redact secrets and tool arguments from error reporting by default.

### Chat loop and persistence

Refactor `openrouter.ts` to return structured streamed output. Accumulate `tool_calls` deltas by index until the model response ends, then parse complete arguments. Do not execute partial streamed arguments. Supply only enabled, successfully discovered tools to a model whose OpenRouter endpoint reports tool support; give a clear fallback or model selection error otherwise.

For each turn, run a bounded sequence: send messages and tool definitions, stream assistant text, collect calls, validate each call against the connection and tool allowlist, request user approval, execute calls, append an assistant tool-call message and one tool result per `tool_call_id`, then call the model again. Set limits for rounds, calls, elapsed time, argument bytes, result bytes, and total prompt tokens. Cancel MCP requests when the chat stream aborts. Handle partial text, denied calls, tool errors, invalid arguments, disconnects, and a model that repeatedly calls the same tool. Preserve OpenRouter's message ordering requirements.

Persist tool events in ordered message rows or a dedicated `MessageToolCall` relation linked to the turn. Update `conversation-persistance.ts`, `conversations.ts`, Redis history, fork/retry, and `model-context.ts` so a resumed or compacted conversation has an intelligible tool history. Keep the user and final assistant text visible even when a tool fails. Count tool schemas, calls, and results against the prompt budget. Trace model and MCP spans without recording credentials or full sensitive results.

Add typed SSE events for tool discovery failures, approval requests, call started, call result, and call failure. The client responds to approval through a user scoped, single use decision endpoint tied to the active conversation turn and call id. Store pending decisions in a short lived shared store so a separate server instance can receive the response; expire them on timeout or cancellation. Protect the endpoint against replay and decisions from another user's session. The transcript should render a clear status for pending, approved, denied, failed, and completed calls.

### Settings and catalog

Add a Connections area under Customize. Include a catalog, custom URL form, token entry, test connection, enable switch, tool list with per tool switches, and delete/disconnect. Explain that connecting a server gives its tools access only after approval. Show a changed tool list and require the user to review newly discovered tools before enabling them.

Catalog seed candidates, subject to live verification during implementation:

| Entry | URL | Initial access |
| --- | --- | --- |
| Cloudflare documentation | `https://docs.mcp.cloudflare.com/mcp` | Public documentation search; verify anonymous access and tool list. |
| GitHub read only | `https://api.githubcopilot.com/mcp/readonly` | User token; do not substitute the app's GitHub login token. |
| Linear read only | `https://mcp.linear.app/mcp/readonly` | User bearer token or OAuth after that milestone. |

Store catalog metadata in code, not credentials. Pin the name, URL, source documentation, auth method, and supported transport. Test catalog URLs during implementation and remove or relabel any entry that cannot connect from the deployed environment. Avoid a general public registry installer in this release.

## Delivery sequence

1. Add a structured OpenRouter tool call parser and a bounded tool loop behind a feature flag. Verify fragmented streaming deltas, one result per call id, cancellation, empty text with tool calls, unsupported models, and accounting.
2. Add the MCP client service, URL protection, connection schema, encrypted token storage, user scoped CRUD and test routes, and unit/integration tests against a local fixture MCP server.
3. Wire approved MCP calls into normal chat, persistence, SSE, retry/fork/compaction, and transcript UI. Test approval replay, cross user isolation, denial, timeouts, result truncation, and stop/disconnect.
4. Add Connections UI and the verified catalog. Test setup, enable/disable, discovery changes, and a real read only call for each catalog server whose test credentials are available.
5. Add OAuth in a separate checkpoint, then update catalog setup flows. Test authorization callback state, token refresh, disconnect, and per user isolation.
6. Run `npm run test:static`, relevant Vitest projects, chat and connection Playwright tests, and a production build. Document deployment key setup and known model/provider limits in the README. Commit and push coherent checkpoints on a `feature/mcp-support` branch from the latest `origin/dev`, then share the feature for review and open a PR to `dev` when the user is satisfied, following `AGENTS.md`.

## Acceptance criteria

- A user can add a custom Streamable HTTP server, supply a token if needed, test it, select tools, and use an approved tool in a single model chat.
- Catalog entries prefill verified endpoints and state their authentication needs. No connection is active until its user authorizes and enables it.
- Calls from one user cannot read another user's connections, credentials, approvals, or tool results. A blocked URL cannot reach an internal address, including after DNS resolution or redirect.
- The model receives one result for every requested tool call. The transcript and a reloaded or forked chat show what happened. Stop cancels the model and MCP work.
- Council and scheduled tasks do not advertise or execute MCP tools in this release.

## Prompt for the implementation agent

> Implement `docs/mcp-support-plan.md` in ChatterStack. Start from the latest `origin/dev` on `feature/mcp-support`. Read `AGENTS.md`, the chat route, OpenRouter streaming code, Prisma schema, context compaction, and existing Skills UI before editing. Work through the delivery sequence in coherent commits and push checkpoints. Use the official MCP TypeScript SDK and confirm its current support for Streamable HTTP and the protocol revisions used by the catalog servers. Keep all MCP calls server side. Treat server metadata, tool schemas, arguments, and results as untrusted. Implement user scoped credentials, URL/DNS/redirect protection, tool allowlists, per call approval, bounded execution, cancellation, persistence, and transcript events. Preserve existing behavior for chats without MCP and keep Council and scheduled tasks tool free. Verify every catalog URL and auth flow before presenting it as ready. Run the specified checks and meaningful integration tests. Report the branch, head SHA, checks, remaining limits, and a review link. Open the PR to `dev` after the feature is reviewed, as required by `AGENTS.md`.

## Sources checked for this plan

- [MCP TypeScript client documentation](https://ts.sdk.modelcontextprotocol.io/client)
- [MCP 2026-07-28 release notes](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [OpenRouter tool calling and streaming](https://openrouter.ai/blog/tutorials/tool-calling/)
- [GitHub remote MCP server](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)
- [Linear MCP server](https://linear.app/docs/mcp)
- [Cloudflare MCP client guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/connect-mcp-client/)
