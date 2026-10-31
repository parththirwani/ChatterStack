import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectionsPage from '@/src/components/customize/ConnectionsPage';
import { catalogAuthLabel, validateConnectionForm } from '@/src/components/customize/ConnectionsPage';
import { MCP_CATALOG } from '@/src/config/mcp-catalog';
import { resetMcpConnectionsCache } from '@/src/lib/client/mcp';
import { useAppStore } from '@/src/store/rootStore';
import type { McpConnectionView } from '@/src/types/mcp.types';
import type { User } from '@/src/types/user.types';

const cloudflare: McpConnectionView = {
  id: 'c1', name: 'Cloudflare documentation', url: 'https://docs.mcp.cloudflare.com/mcp', host: 'docs.mcp.cloudflare.com',
  catalogId: 'cloudflare-docs', transport: 'streamable_http', authMode: 'none', hasCredential: false, enabled: true,
  status: 'connected', lastError: null, lastCheckedAt: '2026-10-31T10:00:00.000Z',
  tools: [{ id: 'search_cloudflare_documentation', name: 'search_cloudflare_documentation', description: 'Search Cloudflare docs.', readOnly: true, schemaBytes: 900, enabled: true }],
  toolCount: 1, needsReview: false, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-31T10:00:00.000Z',
};
const github: McpConnectionView = {
  ...cloudflare, id: 'c2', name: 'GitHub (read only)', url: 'https://api.githubcopilot.com/mcp/readonly', host: 'api.githubcopilot.com',
  catalogId: 'github-readonly', authMode: 'bearer', hasCredential: true, enabled: false, status: 'untested',
  lastCheckedAt: null, tools: [], toolCount: 0,
};

let connections: McpConnectionView[];
let fetcher: ReturnType<typeof vi.fn>;
const calls = (method: string, url: string | RegExp) => fetcher.mock.calls.filter(([input, init]) =>
  (init as RequestInit | undefined)?.method === method && (typeof url === 'string' ? String(input) === url : url.test(String(input))));
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

beforeEach(() => {
  resetMcpConnectionsCache();
  window.history.replaceState(null, '', '/customize/connections');
  useAppStore.setState({ user: { id: 'user-1', name: 'Ada' } as User, drafts: {}, draftsOwner: 'user-1' });
  connections = [{ ...cloudflare }, { ...github }];
  fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/mcp/connections' && method === 'GET') return Response.json({ connections, limit: 10 });
    if (url === '/api/mcp/connections' && method === 'POST') {
      const input = JSON.parse((init as RequestInit).body as string);
      if (input.url && !input.url.startsWith('https://')) return Response.json({ error: 'MCP servers must use HTTPS.', field: 'url' }, { status: 400 });
      const connection: McpConnectionView = {
        ...cloudflare, id: `new-${connections.length + 1}`, name: input.name, url: input.url ?? `catalog:${input.catalogId}`,
        host: input.url ? new URL(input.url).host : 'catalog', catalogId: input.catalogId ?? null,
        authMode: input.token ? 'bearer' : 'none', hasCredential: Boolean(input.token), enabled: false,
        status: 'untested', lastError: null, lastCheckedAt: null, tools: [], toolCount: 0, needsReview: false,
      };
      connections = [...connections, connection];
      return Response.json({ connection }, { status: 201 });
    }
    const match = url.match(/^\/api\/mcp\/connections\/([^/]+)(\/test)?$/);
    if (match && method === 'PATCH') {
      const patch = JSON.parse((init as RequestInit).body as string);
      connections = connections.map((connection) => {
        if (connection.id !== match[1]) return connection;
        const tools = patch.toolEnabled
          ? connection.tools.map((tool) => (patch.toolEnabled[tool.id] === undefined ? tool : { ...tool, enabled: patch.toolEnabled[tool.id] }))
          : connection.tools;
        return {
          ...connection,
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.enabled !== undefined && { enabled: patch.enabled }),
          ...(patch.reviewTools && { needsReview: false }),
          ...(patch.token !== undefined && { hasCredential: true, authMode: 'bearer' as const }),
          ...(patch.clearToken && { hasCredential: false, authMode: 'none' as const }),
          tools,
        };
      });
      return Response.json({ connection: connections.find((connection) => connection.id === match[1]) });
    }
    if (match && method === 'POST' && match[2]) {
      const ok = match[1] === 'c1';
      connections = connections.map((connection) => (connection.id === match[1]
        ? { ...connection, status: ok ? 'connected' : 'error', ok, lastError: ok ? null : 'The server refused the token.' }
        : connection));
      return Response.json({
        connection: { ...connections.find((connection) => connection.id === match[1])!, status: ok ? 'connected' : 'error', lastError: ok ? null : 'The server refused the token.' },
        ok,
        ...(ok ? {} : { error: 'The server refused the token.' }),
      });
    }
    if (match && method === 'DELETE') {
      connections = connections.filter((connection) => connection.id !== match[1]);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Customize → Connections', () => {
  it('lists connections with status, host and token state, and the Customize tabs', async () => {
    render(<ConnectionsPage />);
    const list = await screen.findByRole('region', { name: 'Your connections' });
    expect(within(list).getByText('Cloudflare documentation')).toBeInTheDocument();
    expect(within(list).getByText(/docs\.mcp\.cloudflare\.com · 1 tool · No token/)).toBeInTheDocument();
    expect(within(list).getByText(/^Connected/)).toBeInTheDocument();
    expect(within(list).getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Connections' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'false');
  });

  it('turns a connection off and back on', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const toggle = await screen.findByRole('switch', { name: 'Enable Cloudflare documentation' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[0])).toEqual({ enabled: false });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    await user.click(toggle);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[1])).toEqual({ enabled: true });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('flips a single tool switch with the per-tool allowlist', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const tool = await screen.findByRole('switch', { name: 'Enable search_cloudflare_documentation on Cloudflare documentation' });
    expect(tool).toHaveAttribute('aria-checked', 'true');
    await user.click(tool);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[0])).toEqual({ toolEnabled: { search_cloudflare_documentation: false } });
    await waitFor(() => expect(tool).toHaveAttribute('aria-checked', 'false'));
  });

  it('requires reviewing a changed tool list before turning a connection on', async () => {
    connections = [{ ...cloudflare, enabled: false, needsReview: true }];
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const banner = await screen.findByText(/tool list changed since you last reviewed it/i);
    expect(banner).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review tools for Cloudflare documentation' }));
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[0])).toEqual({ reviewTools: true });
    await waitFor(() => expect(screen.queryByText(/tool list changed since you last reviewed it/i)).toBeNull());
  });

  it('tests a connection and shows a failing server’s error', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Test GitHub (read only)' }));
    expect(calls('POST', '/api/mcp/connections/c2/test')).toHaveLength(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server refused the token.');
  });

  it('deletes a connection after confirming', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete GitHub (read only)' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete GitHub (read only)?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    const list = screen.getByRole('region', { name: 'Your connections' });
    await waitFor(() => expect(within(list).queryByText('GitHub (read only)')).toBeNull());
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(1);
  });
});

describe('tokens', () => {
  it('validates the token dialog before saving', async () => {
    connections = [{ ...cloudflare, authMode: 'bearer' }];
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add token for Cloudflare documentation' }));
    const dialog = screen.getByRole('dialog', { name: 'Add token' });
    await user.click(within(dialog).getByRole('button', { name: 'Save token' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This server needs a token. Paste it first.');
    expect(calls('PATCH', /\/api\/mcp\/connections\//)).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Token'), 'ghp_secret');
    await user.click(within(dialog).getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[0])).toEqual({ token: 'ghp_secret' });
  });

  it('removes a stored token from the dialog', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Change token for GitHub (read only)' }));
    const dialog = screen.getByRole('dialog', { name: 'Change token' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove token' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c2')[0])).toEqual({ clearToken: true });
    await waitFor(() => expect(screen.getByText(/api\.githubcopilot\.com · 0 tools · No token/)).toBeInTheDocument());
  });
});

describe('catalog', () => {
  it('labels each entry by whose token it needs and whether it was verified', () => {
    const byId = new Map(MCP_CATALOG.map((entry) => [entry.id, entry]));
    expect(catalogAuthLabel(byId.get('cloudflare-docs')!)).toBe('No token needed');
    expect(catalogAuthLabel(byId.get('github-readonly')!)).toBe('Needs your own token');
    expect(catalogAuthLabel(byId.get('linear-readonly')!)).toBe('Needs your own token');
    expect(byId.get('cloudflare-docs')!.verified).not.toBeNull();
    expect(byId.get('github-readonly')!.verified).toBeNull();
    expect(byId.get('linear-readonly')!.verified).toBeNull();
  });

  it('shows the labels, connects the anonymous entry directly and asks a token for the others', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const catalog = await screen.findByRole('region', { name: 'Catalog' });
    expect(within(catalog).getByText('Verified 2026-10-31 anonymously')).toBeInTheDocument();
    expect(within(catalog).getAllByText('Not verified yet')).toHaveLength(2);

    await user.click(within(catalog).getByRole('button', { name: 'Connect Cloudflare documentation' }));
    await waitFor(() => expect(calls('POST', '/api/mcp/connections').length).toBe(1));
    expect(bodyOf(calls('POST', '/api/mcp/connections')[0])).toEqual({ name: 'Cloudflare documentation', catalogId: 'cloudflare-docs' });

    await user.click(within(catalog).getByRole('button', { name: 'Connect GitHub (read only)' }));
    const dialog = screen.getByRole('dialog', { name: 'Connect GitHub (read only)' });
    await user.type(within(dialog).getByLabelText('Token'), 'ghp_mine');
    await user.click(within(dialog).getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(calls('POST', '/api/mcp/connections').length).toBe(2));
    expect(bodyOf(calls('POST', '/api/mcp/connections')[1])).toEqual({ name: 'GitHub (read only)', catalogId: 'github-readonly', token: 'ghp_mine' });
  });
});

describe('the custom server form', () => {
  it('blocks a bad name or URL before any request', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const add = screen.getByRole('button', { name: 'Add' });
    await user.click(add);
    expect(await screen.findByRole('alert')).toHaveTextContent('Give this connection a name.');
    expect(calls('POST', '/api/mcp/connections')).toHaveLength(0);

    await user.type(screen.getByLabelText('Connection name'), 'Lan server');
    await user.type(screen.getByLabelText('Server URL'), 'http://mcp.internal/mcp');
    await user.click(add);
    expect(await screen.findByRole('alert')).toHaveTextContent('MCP servers must use HTTPS.');
    expect(calls('POST', '/api/mcp/connections')).toHaveLength(0);

    expect(validateConnectionForm({ name: 'x', url: 'https://user:pw@mcp.example.com/mcp' })?.message).toMatch(/not in the URL/);
  });

  it('adds a valid server with its optional token', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.type(screen.getByLabelText('Connection name'), 'My server');
    await user.type(screen.getByLabelText('Server URL'), 'https://mcp.example.com/mcp');
    await user.type(screen.getByLabelText('Bearer token (optional)'), 'sk-abc');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls('POST', '/api/mcp/connections')).toHaveLength(1));
    expect(bodyOf(calls('POST', '/api/mcp/connections')[0])).toEqual({ name: 'My server', url: 'https://mcp.example.com/mcp', token: 'sk-abc' });
    expect(await screen.findByText('My server')).toBeInTheDocument();
    expect(screen.getByLabelText('Connection name')).toHaveValue('');
  });
});
