/**
 * MCP connections and tool calls in a real browser: the catalog's labels, the
 * review step before a connection may run, tokens that are stored once and never
 * come back, what a saved tool call looks like on reload, and a tool call waiting
 * for a decision in the chat.
 *
 * `/api/chat` stays the shared mock: the real tool loop (discovery, approval
 * storage, execution and saving) is covered by
 * tests/integration/mcp-chat-route.test.ts, which a browser cannot reach. What
 * this spec proves is that the page, the /api/mcp routes and the database agree.
 * Storing a token needs `MCP_CREDENTIAL_KEY` on the app under test; without it
 * the server refuses with a clear message and the spec asserts the token stayed
 * out of the database either way.
 */
import type { Page } from '@playwright/test';
import { deferred, expect, openApp, sendMessage, test } from './support/fixtures';
import { E2E_USER_ID, literal, messageCount, savedMessages, seedConversation, sql } from './support/db';

const CHAT_ID = '22222222-2222-4222-8222-222222222222';
const SERVER_ID = '33333333-3333-4333-8333-333333333333';
const SERVER_URL = 'https://mcp.example.com/mcp';
const DIGEST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SEARCH_TOOL = 'search_cloudflare_documentation';
const FETCH_TOOL = 'fetch_url';

/** Two discovered tools, in the shape the app stores them. */
const TOOLS = `[{"name":"${SEARCH_TOOL}","description":"Search the Cloudflare docs","readOnly":true,"schemaBytes":412},`
  + `{"name":"${FETCH_TOOL}","description":"Fetch one page","readOnly":false,"schemaBytes":180}]`;

interface SeedConnection {
  id: string;
  name: string;
  url?: string;
  catalogId?: string | null;
  authMode?: 'none' | 'bearer';
  credential?: string | null;
  enabled?: boolean;
  status?: string;
  lastError?: string | null;
  tools?: string;
  toolsDigest?: string | null;
  reviewedDigest?: string | null;
  toolEnabled?: string;
}

/** Writes a connection row directly, the way a tested and reviewed one would look. */
function seedConnection(seed: SeedConnection) {
  const optional = (value: string | null | undefined) => (value === undefined || value === null ? 'NULL' : literal(value));
  sql(`INSERT INTO mcp_connections (id, "userId", name, "catalogId", url, transport, "authMode", credential, enabled, status, "lastError", tools, "toolsDigest", "reviewedDigest", "toolEnabled", "createdAt", "updatedAt")
       VALUES (${literal(seed.id)}, ${literal(E2E_USER_ID)}, ${literal(seed.name)}, ${optional(seed.catalogId)}, ${literal(seed.url ?? SERVER_URL)}, 'streamable_http', ${literal(seed.authMode ?? 'none')}, ${optional(seed.credential)}, ${seed.enabled ? 'true' : 'false'}, ${literal(seed.status ?? 'untested')}, ${optional(seed.lastError)}, ${literal(seed.tools ?? '[]')}::jsonb, ${optional(seed.toolsDigest)}, ${optional(seed.reviewedDigest)}, ${literal(seed.toolEnabled ?? '{}')}::jsonb, now(), now())`);
}

/** One tool call saved against an assistant message. */
function seedToolCall(messageId: string, call: {
  callId: string;
  position: number;
  toolId: string;
  name: string;
  arguments: string;
  status: string;
  approval: string;
  result: string;
  truncated?: boolean;
  error?: string | null;
}) {
  const optional = (value: string | null | undefined) => (value === undefined || value === null ? 'NULL' : literal(value));
  sql(`INSERT INTO message_tool_calls (id, "messageId", "callId", "position", "connectionId", "toolId", name, "arguments", status, approval, result, truncated, error, "createdAt")
       VALUES (gen_random_uuid(), ${literal(messageId)}, ${literal(call.callId)}, ${call.position}, ${literal(SERVER_ID)}, ${literal(call.toolId)}, ${literal(call.name)}, ${literal(call.arguments)}, ${literal(call.status)}, ${literal(call.approval)}, ${literal(call.result)}, ${call.truncated ? 'true' : 'false'}, ${optional(call.error)}, now())`);
}

const column = (name: string, expression: string) =>
  sql(`SELECT ${expression} FROM mcp_connections WHERE "userId" = ${literal(E2E_USER_ID)} AND name = ${literal(name)}`);

/** `name:authMode:enabled:status:catalogId` per row, so a whole state fits on one line. */
const connectionRows = () =>
  sql(`SELECT name || ':' || "authMode" || ':' || enabled || ':' || status || ':' || coalesce("catalogId", '-') FROM mcp_connections WHERE "userId" = ${literal(E2E_USER_ID)} ORDER BY name`);
const credentialOf = (name: string) => column(name, 'coalesce(credential, \'\')');
/** The stored per-tool allowlist entry: 'true', 'false' or '-' when absent. */
const toolSwitch = (name: string, tool: string) => column(name, `coalesce("toolEnabled"->>${literal(tool)}, '-')`);
const statusOf = (name: string) => column(name, 'status');
const errorOf = (name: string) => column(name, 'coalesce("lastError", \'\')');
const toolCallRows = (messageId: string) =>
  sql(`SELECT "position" || ':' || name || ':' || status || ':' || approval FROM message_tool_calls WHERE "messageId" = ${literal(messageId)} ORDER BY "position"`);

const connections = (page: Page) => page.getByRole('region', { name: 'Your connections' });
const connectionRow = (page: Page, name: string) => connections(page).locator('li').filter({ hasText: name });
/** Waits for a column the app writes through the API, without hammering psql. */
const dbPoll: { timeout: number; intervals: number[] } = { timeout: 15_000, intervals: [250, 500, 1_000] };

test.beforeEach(() => {
  sql(`DELETE FROM mcp_connections WHERE "userId" = ${literal(E2E_USER_ID)}`);
});

test('Customize has a Connections tab that states what each catalog entry needs', async ({ page }) => {
  await openApp(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Customize' }).click();
  await expect(page).toHaveURL(/\/customize\/skills$/);
  await page.getByRole('tab', { name: 'Connections' }).click();
  await expect(page).toHaveURL(/\/customize\/connections$/);
  await expect(page.getByRole('heading', { name: 'Customize', level: 1 })).toBeVisible();

  const catalog = page.getByRole('region', { name: 'Catalog' });
  const cloudflare = catalog.locator('li').filter({ hasText: 'Cloudflare documentation' });
  await expect(cloudflare.getByText('No token needed')).toBeVisible();
  await expect(cloudflare.getByText('Verified 2026-10-31 anonymously')).toBeVisible();
  await expect(cloudflare.getByRole('button', { name: 'Connect Cloudflare documentation' })).toBeVisible();
  const github = catalog.locator('li').filter({ hasText: 'GitHub (read only)' });
  await expect(github.getByText('Needs your own token')).toBeVisible();
  await expect(github.getByText('Not verified yet')).toBeVisible();
  await expect(github.getByRole('button', { name: 'Connect GitHub (read only)' })).toBeVisible();

  await expect(connections(page)).toContainText('No connections yet');
  await expect(page.getByText('every call waits for your approval in the chat')).toBeVisible();

  // The page URL is the state: a reload lands on the same tab.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Connections' })).toHaveAttribute('aria-selected', 'true');
});

test('connecting from the catalog starts off, untested and without a credential', async ({ page }) => {
  await openApp(page);
  await page.goto('/customize/connections');
  await page.getByRole('button', { name: 'Connect Cloudflare documentation' }).click();

  const row = connectionRow(page, 'Cloudflare documentation');
  await expect(row).toBeVisible();
  expect(connectionRows()).toBe('Cloudflare documentation:none:false:untested:cloudflare-docs');
  expect(credentialOf('Cloudflare documentation')).toBe('');
  await expect(row.getByText('Not tested')).toBeVisible();
  await expect(row.getByText('Off', { exact: true })).toBeVisible();
  await expect(row).toContainText('docs.mcp.cloudflare.com · 0 tools · No token');
  await expect(row.getByRole('switch', { name: 'Enable Cloudflare documentation', exact: true })).toHaveAttribute('aria-checked', 'false');
});

test('a stored tool list is reviewed before the connection runs, and each tool switch is kept', async ({ page }) => {
  seedConnection({ id: SERVER_ID, name: 'Docs server', tools: TOOLS, toolsDigest: DIGEST });
  await openApp(page);
  await page.goto('/customize/connections');
  const row = connectionRow(page, 'Docs server');
  await expect(row.getByText('The tool list changed since you last reviewed it')).toBeVisible();
  await expect(row.getByRole('list', { name: 'Tools on Docs server' })).toContainText(SEARCH_TOOL);
  await expect(row.getByRole('switch', { name: `Enable ${SEARCH_TOOL} on Docs server` })).toHaveAttribute('aria-checked', 'false');

  // Off until the changed list has been looked over: the switch is refused, not ignored.
  await row.getByRole('switch', { name: 'Enable Docs server', exact: true }).click();
  await expect(page.getByText('Review the tool list before turning this connection on.', { exact: true })).toBeVisible();
  expect(statusOf('Docs server')).toBe('untested');
  expect(connectionRows()).toBe('Docs server:none:false:untested:-');

  await row.getByRole('button', { name: 'Review tools for Docs server' }).click();
  await expect(row.getByText('The tool list changed since you last reviewed it')).toHaveCount(0);

  await row.getByRole('switch', { name: `Enable ${SEARCH_TOOL} on Docs server` }).click();
  await expect.poll(() => toolSwitch('Docs server', SEARCH_TOOL), dbPoll).toBe('true');
  await row.getByRole('switch', { name: `Enable ${FETCH_TOOL} on Docs server` }).click();
  await expect.poll(() => toolSwitch('Docs server', FETCH_TOOL), dbPoll).toBe('true');
  await row.getByRole('switch', { name: `Enable ${FETCH_TOOL} on Docs server` }).click();
  await expect.poll(() => toolSwitch('Docs server', FETCH_TOOL), dbPoll).toBe('-');
  await expect.poll(() => toolSwitch('Docs server', SEARCH_TOOL), dbPoll).toBe('true');

  await row.getByRole('switch', { name: 'Enable Docs server', exact: true }).click();
  await expect(row.getByRole('switch', { name: 'Enable Docs server', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => connectionRows(), dbPoll).toBe('Docs server:none:true:untested:-');
});

test('the token dialog never shows a stored token, and removing one clears the column', async ({ page }) => {
  seedConnection({ id: SERVER_ID, name: 'Docs server', authMode: 'bearer', credential: 'v1.ivB64.tagB64.cipherB64' });
  await openApp(page);
  await page.goto('/customize/connections');
  const row = connectionRow(page, 'Docs server');
  await expect(row).toContainText('Token stored');

  await row.getByRole('button', { name: 'Change token for Docs server' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change token' });
  await expect(dialog.getByLabel('New token')).toBeVisible();
  await expect(dialog.getByText('Stored encrypted on the server')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('ivB64');
  await dialog.getByRole('button', { name: 'Save token' }).click();
  await expect(dialog.getByRole('alert')).toContainText('This server needs a token');

  await dialog.getByRole('button', { name: 'Remove token' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => credentialOf('Docs server'), dbPoll).toBe('');
  await expect(connectionRow(page, 'Docs server')).toContainText('No token');
});

test('a token typed into the dialog is stored encrypted or refused, never in the clear', async ({ page }) => {
  const secret = 'fixture-token-value-for-e2e';
  seedConnection({ id: SERVER_ID, name: 'Docs server' });
  await openApp(page);
  await page.goto('/customize/connections');
  await connectionRow(page, 'Docs server').getByRole('button', { name: 'Add token for Docs server' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add token' });
  await dialog.getByLabel('Token').fill(secret);
  await dialog.getByRole('button', { name: 'Save token' }).click();
  // Stored when the deployment has MCP_CREDENTIAL_KEY, refused out loud when it does not.
  await expect.poll(async () => !(await dialog.isVisible()) || (await dialog.getByRole('alert').count()) > 0).toBe(true);
  const stored = credentialOf('Docs server');
  expect(stored.includes(secret)).toBe(false);
  if (stored) expect(stored.startsWith('v1.')).toBe(true);
  if (await dialog.isVisible()) await expect(dialog.getByRole('alert')).toContainText('MCP_CREDENTIAL_KEY');
  await expect(page.locator('body')).not.toContainText(secret);
  expect(await (await page.request.get('/api/mcp/connections')).text()).not.toContain(secret);
});

test('the custom server form refuses plain HTTP and URL credentials, then adds the server', async ({ page }) => {
  await openApp(page);
  await page.goto('/customize/connections');
  const form = page.getByRole('region', { name: 'Add a custom server' });
  await form.getByLabel('Connection name').fill('Docs server');
  await form.getByLabel('Server URL').fill('http://mcp.example.com/mcp');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('MCP servers must use HTTPS.');

  await form.getByLabel('Server URL').fill('https://user:pass@mcp.example.com/mcp');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Put credentials in the token field, not in the URL.');

  await form.getByLabel('Server URL').fill(SERVER_URL);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(connectionRow(page, 'Docs server')).toBeVisible();
  expect(connectionRows()).toBe('Docs server:none:false:untested:-');
  await expect(form.getByLabel('Connection name')).toHaveValue('');
  await expect(form.getByLabel('Server URL')).toHaveValue('');
});

test('Test on an unreachable server stores a visible failure instead of a tool list', async ({ page }) => {
  test.setTimeout(60_000);
  seedConnection({
    id: SERVER_ID, name: 'Docs server', enabled: true, tools: TOOLS, toolsDigest: DIGEST, reviewedDigest: DIGEST,
    toolEnabled: `{"${SEARCH_TOOL}": true}`,
  });
  await openApp(page);
  await page.goto('/customize/connections');
  const row = connectionRow(page, 'Docs server');
  await expect(row.getByRole('list', { name: 'Tools on Docs server' })).toBeVisible();
  expect(toolSwitch('Docs server', SEARCH_TOOL)).toBe('true');

  await row.getByRole('button', { name: 'Test Docs server' }).click();
  await expect.poll(() => statusOf('Docs server'), { timeout: 30_000, intervals: [250, 500, 1_000] }).toBe('error');
  await expect(row.getByText('Error', { exact: true })).toBeVisible();
  // The stored reason is exactly what the page shows, and a failed test keeps nothing enabled.
  const shown = errorOf('Docs server');
  expect(shown.length).toBeGreaterThan(0);
  await expect(row.getByText(shown, { exact: true }).first()).toBeVisible();
  await expect(row.getByText('Off', { exact: true })).toBeVisible();
  expect(toolSwitch('Docs server', SEARCH_TOOL)).toBe('-');
  expect(connectionRows()).toBe('Docs server:none:false:error:-');
});

test('a saved tool call is part of the chat after a reload', async ({ page }) => {
  seedConversation({
    id: CHAT_ID,
    title: 'Workers assets',
    updated: 20,
    messages: [
      { role: 'user', content: 'What are Workers static assets?' },
      { role: 'assistant', content: 'They are files deployed alongside a Worker.', modelId: 'anthropic/claude-sonnet-5.5' },
    ],
  });
  const assistantId = savedMessages(CHAT_ID)[1].id;
  seedToolCall(assistantId, {
    callId: 'call_one', position: 0, toolId: SEARCH_TOOL, name: 'Docs_server_search_cloudflare_documentation',
    arguments: '{"query":"static assets"}', status: 'completed', approval: 'approved',
    result: 'Assets are files uploaded with a Worker.', truncated: true,
  });
  seedToolCall(assistantId, {
    callId: 'call_two', position: 1, toolId: FETCH_TOOL, name: 'Docs_server_fetch_url',
    arguments: '{"url":"https://example.com/a"}', status: 'denied', approval: 'denied',
    result: 'The user did not approve this call.',
  });
  expect(toolCallRows(assistantId))
    .toBe('0:Docs_server_search_cloudflare_documentation:completed:approved\n1:Docs_server_fetch_url:denied:denied');

  await openApp(page, {}, `/${CHAT_ID}`);
  const card = page.getByRole('region', { name: 'Tool calls' });
  await expect(card.getByText('Docs_server_search_cloudflare_documentation')).toBeVisible();
  await expect(card.getByText('Completed', { exact: true })).toBeVisible();
  await expect(card.getByText('result shortened')).toBeVisible();
  await expect(card.getByText('Denied', { exact: true })).toBeVisible();
  await card.getByText('Result sent to the model').click();
  await expect(card.getByText('Assets are files uploaded with a Worker.')).toBeVisible();
  await expect(page.getByText('They are files deployed alongside a Worker.')).toBeVisible();
});

test('a tool call in the chat waits for a decision and spends it once', async ({ page, mockChat }) => {
  const held = deferred();
  const decisions: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/mcp/tool-approvals')) decisions.push(request.method());
  });

  await openApp(page);
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ chunk: 'Let me check the docs.' });
    stream.send({
      toolApprovalRequest: {
        approvalId: 'e2e-approval-1', callId: 'call_one', name: 'Docs_server_search_cloudflare_documentation',
        toolId: SEARCH_TOOL, connectionId: SERVER_ID, arguments: { query: 'Workers static assets' },
        round: 1, expiresAt: Date.now() + 120_000,
      },
    });
    await held.promise;
    stream.send({ chunk: ' They sit next to the script.' });
    stream.saveMessages('Let me check the docs. They sit next to the script.');
    stream.end();
  });
  await sendMessage(page, 'What are Workers static assets?');

  const card = page.getByRole('region', { name: 'Tool calls' });
  await expect(card.getByText('Needs your approval')).toBeVisible();
  await expect(card).toContainText('Workers static assets');
  await expect(card.getByRole('button', { name: 'Approve Docs_server_search_cloudflare_documentation' })).toBeVisible();

  // The decision goes to the real endpoint, which holds no pending call with that id.
  await card.getByRole('button', { name: 'Deny Docs_server_search_cloudflare_documentation' }).click();
  await expect(card.getByRole('alert')).toContainText('That approval was already decided or has ended.');
  await expect(card.getByRole('button', { name: 'Deny Docs_server_search_cloudflare_documentation' })).toHaveCount(0);
  expect(decisions).toEqual(['POST']);

  // The turn is never held hostage by a spent decision: prose and saving continue.
  held.resolve();
  await expect(page.getByText('They sit next to the script.')).toBeVisible();
  const chatId = page.url().split('/').at(-1)!;
  await expect.poll(() => messageCount(chatId), dbPoll).toBe(2);
  await expect(page.getByRole('paragraph').filter({ hasText: 'What are Workers static assets?' }).first()).toBeVisible();
});
