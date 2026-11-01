import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectionsPage from '@/src/components/customize/ConnectionsPage';
import { catalogAuthLabel, filterCatalog, validateConnectionForm } from '@/src/lib/client/mcp-validation';
import { describeMcpFailure } from '@/src/lib/client/mcp-failure';
import { serverRowStatus } from '@/src/components/customize/connections/ServerRow';
import { MCP_CATALOG } from '@/src/config/mcp-catalog';
import { MCP_TOOL_DEFINITION_BUDGET_TOKENS } from '@/src/lib/client/mcp-budget';
import { resetMcpConnectionsCache } from '@/src/lib/client/mcp';
import { useAppStore } from '@/src/store/rootStore';
import type { McpConnectionView, McpToolView } from '@/src/types/mcp.types';
import type { User } from '@/src/types/user.types';

const cloudflare: McpConnectionView = {
  id: 'c1', name: 'Cloudflare documentation', url: 'https://docs.mcp.cloudflare.com/mcp', host: 'docs.mcp.cloudflare.com',
  catalogId: 'cloudflare-docs', transport: 'streamable_http', authMode: 'none', hasCredential: false, enabled: true,
  status: 'connected', lastError: null, lastCheckedAt: '2026-10-31T10:00:00.000Z',
  tools: [
    { id: 'search_cloudflare_documentation', name: 'search_cloudflare_documentation', description: 'Search Cloudflare docs.', readOnly: true, access: 'read', schemaBytes: 900, estimatedTokens: 180, enabled: true },
    { id: 'fetch_url', name: 'fetch_url', description: 'Fetch one page.', readOnly: false, access: 'write', schemaBytes: 220, estimatedTokens: null, enabled: false },
  ],
  toolCount: 2, needsReview: false, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-31T10:00:00.000Z',
};
const github: McpConnectionView = {
  ...cloudflare, id: 'c2', name: 'GitHub (read only)', url: 'https://api.githubcopilot.com/mcp/readonly', host: 'api.githubcopilot.com',
  catalogId: 'github-readonly', authMode: 'bearer', hasCredential: true, enabled: false, status: 'untested',
  lastCheckedAt: null, tools: [], toolCount: 0,
};
const linear: McpConnectionView = {
  ...github, id: 'c3', name: 'Linear (read only)', url: 'https://mcp.linear.app/mcp/readonly', host: 'mcp.linear.app',
  catalogId: 'linear-readonly', hasCredential: false,
};

let connections: McpConnectionView[];
let fetcher: ReturnType<typeof vi.fn>;
/** What the next discovery attempt answers: the real tools, or a classified failure. */
type Discovery = { kind: 'ok'; tools: McpToolView[] } | { kind: 'error'; code: string; error: string };
let discovery: Discovery;
const discoveredTools: McpToolView[] = [
  { id: 'search_cloudflare_documentation', name: 'search_cloudflare_documentation', description: 'Search the Cloudflare docs.', readOnly: true, access: 'read', schemaBytes: 412, estimatedTokens: 180, enabled: false },
  { id: 'fetch_url', name: 'fetch_url', description: 'Fetch one page.', readOnly: false, access: 'write', schemaBytes: 180, estimatedTokens: 96, enabled: false },
];
const calls = (method: string, url: string | RegExp) => fetcher.mock.calls.filter(([input, init]) =>
  (init as RequestInit | undefined)?.method === method && (typeof url === 'string' ? String(input) === url : url.test(String(input))));
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

beforeEach(() => {
  resetMcpConnectionsCache();
  window.history.replaceState(null, '', '/customize/connections');
  useAppStore.setState({ user: { id: 'user-1', name: 'Ada' } as User, drafts: {}, draftsOwner: 'user-1' });
  connections = [{ ...cloudflare }, { ...github }];
  discovery = { kind: 'ok', tools: discoveredTools };
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
        let tools = connection.tools;
        if (patch.toolEnabled) {
          tools = tools.map((tool) => (patch.toolEnabled[tool.id] === undefined ? tool : { ...tool, enabled: patch.toolEnabled[tool.id] }));
        }
        // A real switch-off also clears the per-tool allowlist, like the server does.
        if (patch.enabled === false) tools = tools.map((tool) => ({ ...tool, enabled: false }));
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
      const answer = discovery;
      if (answer.kind === 'error') {
        connections = connections.map((connection) => (connection.id === match[1]
          ? { ...connection, status: 'error', lastError: answer.error, enabled: false, tools: [], toolCount: 0 }
          : connection));
        return Response.json({ connection: connections.find((connection) => connection.id === match[1]), ok: false, error: answer.error, code: answer.code });
      }
      connections = connections.map((connection) => (connection.id === match[1]
        ? { ...connection, status: 'connected', lastError: null, tools: answer.tools, toolCount: answer.tools.length, needsReview: true }
        : connection));
      return Response.json({ connection: connections.find((connection) => connection.id === match[1]), ok: true });
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const block = () => screen.getByRole('region', { name: 'MCP servers' });
const findBlock = async () => screen.findByRole('region', { name: 'MCP servers' });
const rowTrigger = async (name: string | RegExp) => screen.findByRole('button', { name });

describe('Customize → Connections management block', () => {
  it('lists servers with real status, transport, enabled count and the header meter', async () => {
    render(<ConnectionsPage />);
    const list = await findBlock();
    expect(within(list).getByText('Cloudflare documentation')).toBeInTheDocument();
    expect(within(list).getByText('Connected')).toBeInTheDocument();
    expect(within(list).getByText('Not tested')).toBeInTheDocument();
    expect(within(list).getByText('Off')).toBeInTheDocument();
    expect(within(list).getAllByText('Remote')).toHaveLength(2);
    expect(within(list).getByText('1 of 2 tools on')).toBeInTheDocument();
    expect(within(list).getByText('about 180 tokens (estimated)')).toBeInTheDocument();
    const meter = within(list).getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', String(MCP_TOOL_DEFINITION_BUDGET_TOKENS));
    expect(meter).toHaveAttribute('aria-valuenow', '180');
    expect(meter).toHaveAttribute('aria-valuetext', '180 of 8,000 budgeted tokens (estimated)');
    expect(within(list).getByText('180 of 8,000 tokens (estimated)')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Connections' })).toHaveAttribute('aria-selected', 'true');
  });

  it('gives each row a full accessible name: server, status, transport, tools on and cost', async () => {
    render(<ConnectionsPage />);
    const trigger = await rowTrigger('Cloudflare documentation, Connected, remote transport, 1 of 2 tools on, about 180 tokens (estimated)');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'mcp-server-panel-c1');
  });

  it('maps the real statuses: needs sign-in before a token, stored error text on failure, connecting while testing', () => {
    expect(serverRowStatus({ ...linear, enabled: false })).toMatchObject({ word: 'Needs sign-in' });
    expect(serverRowStatus({ ...github })).toMatchObject({ word: 'Not tested' });
    expect(serverRowStatus({ ...cloudflare })).toMatchObject({ word: 'Connected' });
    expect(serverRowStatus({ ...github, status: 'error', lastError: 'The MCP server rejected the token.' })).toMatchObject({ word: 'Needs sign-in' });
    expect(serverRowStatus({ ...github, authMode: 'none', status: 'error', lastError: 'The MCP server could not be reached.' })).toMatchObject({ word: 'Error' });
    expect(serverRowStatus({ ...cloudflare }, true)).toMatchObject({ word: 'Connecting' });
  });

  it('shows the endpoint, read/write words and per-tool estimates in the expanded row', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await rowTrigger(/^Cloudflare documentation, Connected/));
    const list = await findBlock();
    expect(within(list).getByText('https://docs.mcp.cloudflare.com/mcp')).toBeInTheDocument();
    const tools = within(list).getByRole('list', { name: 'Tools on Cloudflare documentation' });
    expect(within(tools).getByText('read')).toBeInTheDocument();
    expect(within(tools).getByText('write')).toBeInTheDocument();
    expect(within(tools).getByText('≈180 tokens (est.)')).toBeInTheDocument();
    expect(within(tools).getByText('estimate pending')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Remove Cloudflare documentation' })).toBeInTheDocument();
  });

  it('moves focus between rows with arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const first = await rowTrigger(/^Cloudflare documentation, Connected/);
    const second = await rowTrigger(/^GitHub \(read only\), Not tested/);
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
  });

  it('says plainly when a failing server stored a readable error', async () => {
    connections = [{ ...linear, status: 'error', lastError: 'The MCP server rejected the token.', hasCredential: true }];
    render(<ConnectionsPage />);
    const list = await findBlock();
    expect(within(list).getByText('Needs sign-in')).toBeInTheDocument();
    expect(within(list).getByText('The MCP server rejected the token.')).toBeInTheDocument();
  });
});

describe('the context meter', () => {
  it('only counts enabled tools of connected, switched-on, reviewed servers', async () => {
    connections = [{ ...github, enabled: true, tools: [{ ...cloudflare.tools[0], enabled: true, estimatedTokens: 500 }] }];
    render(<ConnectionsPage />);
    expect(await screen.findByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0 of 8,000 tokens (estimated)')).toBeInTheDocument();

    connections = [{ ...connections[0], status: 'connected' }];
    window.dispatchEvent(new Event('chatterstack:mcp-connections-changed'));
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '500'));

    // A list awaiting review never reaches the model, so it never hits the meter.
    connections = [{ ...connections[0], needsReview: true }];
    window.dispatchEvent(new Event('chatterstack:mcp-connections-changed'));
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0'));
  });

  it('turns amber with the over-by amount past the budget', async () => {
    connections = [{ ...cloudflare, tools: [{ ...cloudflare.tools[0], estimatedTokens: 9_000 }] }];
    render(<ConnectionsPage />);
    const meter = await screen.findByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '9000');
    expect(meter).toHaveAttribute('aria-valuetext', '9,000 of 8,000 budgeted tokens (estimated), 1,000 over budget');
    expect(screen.getByText('Over budget by 1,000 tokens (estimated)')).toBeInTheDocument();
  });

  it('admits when an enabled tool has no stored estimate yet', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await rowTrigger(/^Cloudflare documentation, Connected/));
    await user.click(await screen.findByRole('switch', { name: 'Enable fetch_url on Cloudflare documentation' }));
    expect(await screen.findByText('1 tool has no estimate yet; re-test the connection.')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '180');
  });

  it('moves the meter together with the tool switch and persists through PATCH', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await rowTrigger(/^Cloudflare documentation, Connected/));
    const tool = await screen.findByRole('switch', { name: 'Enable search_cloudflare_documentation on Cloudflare documentation' });
    await user.click(tool);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[0])).toEqual({ toolEnabled: { search_cloudflare_documentation: false } });
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0'));
    await waitFor(() => expect(tool).toHaveAttribute('aria-checked', 'false'));
    await user.click(tool);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[1])).toEqual({ toolEnabled: { search_cloudflare_documentation: true } });
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '180'));
  });
});

describe('turning servers off', () => {
  it('turns a connection off and back on, clearing tool counts with it', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const toggle = await screen.findByRole('switch', { name: 'Enable Cloudflare documentation' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[0])).toEqual({ enabled: false });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0'));
    await user.click(toggle);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[1])).toEqual({ enabled: true });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('requires reviewing a changed tool list before turning a connection on', async () => {
    connections = [{ ...cloudflare, enabled: false, needsReview: true }];
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await rowTrigger(/^Cloudflare documentation, Connected/));
    expect(await screen.findByText(/tool list changed since you last reviewed it/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review tools for Cloudflare documentation' }));
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c1')[0])).toEqual({ reviewTools: true });
    await waitFor(() => expect(screen.queryByText(/tool list changed since you last reviewed it/i)).toBeNull());
  });

  it('tests a connection and shows a failing server’s error', async () => {
    discovery = { kind: 'error', code: 'unauthorized', error: 'The server refused the token.' };
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await rowTrigger(/^GitHub \(read only\), Not tested/));
    await user.click(await screen.findByRole('button', { name: 'Test GitHub (read only)' }));
    expect(calls('POST', '/api/mcp/connections/c2/test')).toHaveLength(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server refused the token.');
  });
});

describe('removal with an undo window', () => {
  // Already rendered before fake timers switch on; findByRole would poll on fakes.
  const startRemoval = (triggerName: RegExp, serverName: string) => {
    fireEvent.click(screen.getByRole('button', { name: triggerName }));
    fireEvent.click(screen.getByRole('button', { name: `Remove ${serverName}` }));
  };
  const bar = () => screen.getByRole('group', { name: /Removing/ });

  it('hides the row at once and sends the DELETE only when the window closes', async () => {
    render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    expect(within(block()).queryByText('GitHub (read only)')).toBeNull();
    expect(within(block()).queryByRole('button', { name: 'Remove GitHub (read only)' })).toBeNull();
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(screen.queryByRole('group', { name: /Removing/ })).toBeNull();
    expect(screen.getByText('GitHub (read only) removed.')).toBeInTheDocument();
  });

  it('Undo brings the row back and no DELETE is ever sent', async () => {
    render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('group', { name: /Removing/ })).toBeNull();
    expect(within(block()).getByText('GitHub (read only)')).toBeInTheDocument();
    expect(screen.getByText('GitHub (read only) kept. Nothing was deleted.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(0);
  });

  it('pauses the countdown while the pointer rests on the bar', async () => {
    render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    fireEvent.pointerOver(bar());
    fireEvent.pointerEnter(bar());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(0);
    fireEvent.pointerOut(bar());
    fireEvent.pointerLeave(bar());
    await vi.advanceTimersByTimeAsync(6_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(1);
  });

  it('pauses the countdown while keyboard focus rests on the bar', async () => {
    render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    fireEvent.focus(bar());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(0);
    fireEvent.blur(bar());
    await vi.advanceTimersByTimeAsync(6_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(1);
  });

  it('unmounting with the bar open sends nothing and leaves the connection intact', async () => {
    const view = render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    view.unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(0);
    // A remount finds the server exactly where it was: the safe direction.
    render(<ConnectionsPage />);
    expect(within(block()).getByText('GitHub (read only)')).toBeInTheDocument();
  });

  it('a second removal closes the first window right away', async () => {
    render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    await startRemoval(/^Cloudflare documentation, Connected/, 'Cloudflare documentation');
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(1);
    expect(calls('DELETE', '/api/mcp/connections/c1')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Removing Cloudflare documentation' })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(calls('DELETE', '/api/mcp/connections/c1')).toHaveLength(1);
  });

  it('Escape folds the bar away but the countdown keeps running', async () => {
    render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    fireEvent.keyDown(bar(), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: /Removing/ })).toBeNull();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(1);
  });

  it('Ctrl/Cmd+Z brings the folded bar back while the removal is still pending', async () => {
    render(<ConnectionsPage />);
    await screen.findByRole('meter');
    vi.useFakeTimers();
    await startRemoval(/^GitHub \(read only\), Not tested/, 'GitHub (read only)');
    fireEvent.keyDown(bar(), { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('group', { name: 'Removing GitHub (read only)' })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2_000);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls('DELETE', '/api/mcp/connections/c2')).toHaveLength(0);
    expect(within(block()).getByText('GitHub (read only)')).toBeInTheDocument();
  });
});

describe('tokens', () => {
  it('validates the token dialog before saving', async () => {
    connections = [{ ...cloudflare, authMode: 'bearer' }];
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await rowTrigger(/^Cloudflare documentation, Connected/));
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
    await user.click(await rowTrigger(/^GitHub \(read only\), Not tested/));
    await user.click(await screen.findByRole('button', { name: 'Change token for GitHub (read only)' }));
    const dialog = screen.getByRole('dialog', { name: 'Change token' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove token' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/c2')[0])).toEqual({ clearToken: true });
    await waitFor(() => expect(within(block()).getByText(/No token/)).toBeInTheDocument());
  });
});

describe('the add-server sheet', () => {
  const sheet = () => screen.getByRole('dialog');
  const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'Add server' }));
    await screen.findByRole('listbox', { name: 'MCP directory' });
  };
  const pageBackground = () => document.querySelector<HTMLElement>('[data-mcp-page]');

  it('keeps the card inert while it is open and hands focus back on Escape', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const trigger = await screen.findByRole('button', { name: 'Add server' });
    await user.click(trigger);
    expect(sheet()).toBeInTheDocument();
    expect(pageBackground()).toHaveAttribute('inert');
    expect(screen.getByLabelText('Search the directory')).toHaveFocus();
    // Tab from the last control stays inside the sheet.
    const close = within(sheet()).getByRole('button', { name: 'Close' });
    close.focus();
    await user.tab();
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pageBackground()).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
  });

  it('searches the real catalog by name, host or purpose and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await openSheet(user);
    const list = screen.getByRole('listbox', { name: 'MCP directory' });
    expect(within(list).getAllByRole('option')).toHaveLength(MCP_CATALOG.length);
    const cloudflareEntry = within(list).getByRole('option', { name: /Cloudflare documentation/ });
    expect(cloudflareEntry).toHaveTextContent('No token needed');
    expect(cloudflareEntry).toHaveTextContent('Verified 2026-10-31 anonymously');
    expect(within(list).getByRole('option', { name: /GitHub \(read only\)/ })).toHaveTextContent('Needs your own token');

    await user.type(within(sheet()).getByLabelText('Search the directory'), 'linear');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    await user.clear(within(sheet()).getByLabelText('Search the directory'));
    await user.type(within(sheet()).getByLabelText('Search the directory'), 'nowhere');
    expect(within(list).queryByRole('option')).toBeNull();
    expect(screen.getByText(/Nothing in the directory matches/)).toBeInTheDocument();
  });

  it('moves focus between the search field and the entries with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await openSheet(user);
    const search = screen.getByLabelText('Search the directory');
    const list = screen.getByRole('listbox', { name: 'MCP directory' });
    const [first, second] = within(list).getAllByRole('option');
    expect(search).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(search).toHaveFocus();
  });

  it('connects the verified entry through the real API and lands every tool off for review', async () => {
    connections = [{ ...github }];
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await openSheet(user);
    await user.click(within(sheet()).getByRole('option', { name: /Cloudflare documentation/ }));
    const dialog = sheet();
    expect(within(dialog).getByRole('heading', { name: 'Connect Cloudflare documentation' })).toBeInTheDocument();
    expect(within(dialog).getByText(/No token is needed/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Your token')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Connect to docs.mcp.cloudflare.com' }));
    await waitFor(() => expect(calls('POST', '/api/mcp/connections')).toHaveLength(1));
    expect(bodyOf(calls('POST', '/api/mcp/connections')[0])).toEqual({ name: 'Cloudflare documentation', catalogId: 'cloudflare-docs' });
    expect(calls('POST', '/api/mcp/connections/new-2/test')).toHaveLength(1);

    // The row slid into the card behind the sheet while the tools were arriving.
    const block = await findBlock();
    expect(within(block).getByText('Cloudflare documentation')).toBeInTheDocument();
    expect(document.querySelector('[data-row-id="new-2"]')).toHaveAttribute('data-entering', 'true');

    // They land one by one rather than all at once.
    expect(await within(sheet()).findByText(/more arriving…/)).toBeInTheDocument();
    const found = await screen.findByRole('list', { name: 'Discovered tools' });
    expect(await within(found).findByText('fetch_url')).toBeInTheDocument();
    expect(within(found).getByText('read')).toBeInTheDocument();
    expect(within(found).getByText('write')).toBeInTheDocument();
    expect(within(found).getAllByText('off')).toHaveLength(2);
    expect(within(found).getByText('≈180 tokens (est.)')).toBeInTheDocument();
    // Nothing is switched on for the person, reads included.
    expect(calls('PATCH', /\/api\/mcp\/connections\//)).toHaveLength(0);
    expect(await within(sheet()).findByText(/Every tool arrived off/)).toBeInTheDocument();

    await user.click(within(sheet()).getByRole('button', { name: 'Show me the server' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const row = await rowTrigger(/^Cloudflare documentation, Connected, remote transport, 0 of 2 tools on, no tools on/);
    expect(row).toHaveFocus();
  });

  it('names the token a catalog entry needs and refuses to connect without it', async () => {
    connections = [];
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await openSheet(user);
    await user.click(within(sheet()).getByRole('option', { name: /GitHub \(read only\)/ }));
    const dialog = sheet();
    expect(within(dialog).getByText(/needs your own GitHub token/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/never to another server, another user, or the model/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Connect to api.githubcopilot.com' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This server needs your token before it will answer.');
    expect(calls('POST', '/api/mcp/connections')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Your token'), 'ghp_mine');
    await user.click(within(dialog).getByRole('button', { name: 'Connect to api.githubcopilot.com' }));
    await waitFor(() => expect(calls('POST', '/api/mcp/connections')).toHaveLength(1));
    expect(bodyOf(calls('POST', '/api/mcp/connections')[0])).toEqual({ name: 'GitHub (read only)', catalogId: 'github-readonly', token: 'ghp_mine' });
  });

  it('turns a refused token into words and retries the same connection with a new token', async () => {
    connections = [];
    discovery = { kind: 'error', code: 'unauthorized', error: 'The MCP server rejected the token.' };
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await openSheet(user);
    await user.click(within(sheet()).getByRole('option', { name: /GitHub \(read only\)/ }));
    const dialog = sheet();
    await user.type(within(dialog).getByLabelText('Your token'), 'ghp_wrong');
    await user.click(within(dialog).getByRole('button', { name: 'Connect to api.githubcopilot.com' }));
    expect(await within(dialog).findByText(/The server said: The MCP server rejected the token\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/in your list, switched off/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Try another token' }));
    expect(within(sheet()).getByRole('heading', { name: 'Connect GitHub (read only)' })).toBeInTheDocument();
    discovery = { kind: 'ok', tools: discoveredTools };
    await user.type(within(sheet()).getByLabelText('Your token'), 'ghp_right');
    await user.click(within(sheet()).getByRole('button', { name: 'Connect to api.githubcopilot.com' }));
    // The retry reuses the connection the first attempt made: one create, two tests.
    await waitFor(() => expect(calls('POST', '/api/mcp/connections/new-1/test')).toHaveLength(2));
    expect(calls('POST', '/api/mcp/connections')).toHaveLength(1);
    expect(bodyOf(calls('PATCH', '/api/mcp/connections/new-1')[0])).toEqual({ token: 'ghp_right' });
    expect(await screen.findByRole('list', { name: 'Discovered tools' })).toBeInTheDocument();
  });

  it('explains a server that offers more tools than one connection may hold', async () => {
    connections = [];
    discovery = { kind: 'error', code: 'too_many_tools', error: 'This MCP server offers 40 tools, which is more than the 32 allowed per connection.' };
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await openSheet(user);
    await user.click(within(sheet()).getByRole('option', { name: /Cloudflare documentation/ }));
    await user.click(within(sheet()).getByRole('button', { name: 'Connect to docs.mcp.cloudflare.com' }));
    expect(await within(sheet()).findByText(/more tools than one connection may hold/)).toBeInTheDocument();
    // Retrying cannot help a limit the server itself reports, so no Try again is offered.
    expect(within(sheet()).queryByRole('button', { name: /^Try again/ })).toBeNull();
    expect(within(sheet()).getByRole('button', { name: 'Back to the directory' })).toBeInTheDocument();
  });

  it('validates a custom URL before anything leaves the browser, then connects it', async () => {
    connections = [];
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await openSheet(user);
    await user.click(within(sheet()).getByRole('button', { name: /Add any HTTPS MCP server by URL/ }));
    const dialog = sheet();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give this connection a name.');
    expect(calls('POST', '/api/mcp/connections')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Connection name'), 'My server');
    await user.type(within(dialog).getByLabelText('Server URL'), 'http://mcp.internal/mcp');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('MCP servers must use HTTPS.');
    expect(calls('POST', '/api/mcp/connections')).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('Server URL'));
    await user.type(within(dialog).getByLabelText('Server URL'), 'https://mcp.example.com/mcp');
    await user.type(within(dialog).getByLabelText('Bearer token (optional)'), 'sk-abc');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(sheet()).getByText(/sends it just to mcp\.example\.com/)).toBeInTheDocument();
    await user.click(within(sheet()).getByRole('button', { name: 'Connect to mcp.example.com' }));
    await waitFor(() => expect(calls('POST', '/api/mcp/connections')).toHaveLength(1));
    expect(bodyOf(calls('POST', '/api/mcp/connections')[0])).toEqual({ name: 'My server', url: 'https://mcp.example.com/mcp', token: 'sk-abc' });
    expect(validateConnectionForm({ name: 'x', url: 'https://user:pw@mcp.example.com/mcp' })?.message).toMatch(/not in the URL/);
  });
});

describe('the directory and its failure wording', () => {
  const byId = new Map(MCP_CATALOG.map((entry) => [entry.id, entry]));

  it('labels each entry by whose token it needs and whether it was verified', () => {
    expect(catalogAuthLabel(byId.get('cloudflare-docs')!)).toBe('No token needed');
    expect(catalogAuthLabel(byId.get('github-readonly')!)).toBe('Needs your own token');
    expect(catalogAuthLabel(byId.get('linear-readonly')!)).toBe('Needs your own token');
    expect(byId.get('cloudflare-docs')!.verified).not.toBeNull();
    expect(byId.get('github-readonly')!.verified).toBeNull();
    expect(byId.get('linear-readonly')!.verified).toBeNull();
  });

  it('filters the directory by any word, in any field', () => {
    expect(filterCatalog(MCP_CATALOG, '')).toHaveLength(MCP_CATALOG.length);
    expect(filterCatalog(MCP_CATALOG, '  LiNeAr  ').map((entry) => entry.id)).toEqual(['linear-readonly']);
    expect(filterCatalog(MCP_CATALOG, 'workers').map((entry) => entry.id)).toEqual(['cloudflare-docs']);
    expect(filterCatalog(MCP_CATALOG, 'githubcopilot').map((entry) => entry.id)).toEqual(['github-readonly']);
    expect(filterCatalog(MCP_CATALOG, 'issues projects')).toHaveLength(1);
    expect(filterCatalog(MCP_CATALOG, 'nothing like this')).toHaveLength(0);
  });

  it('maps the real MCP failure classes onto the retry that can help', () => {
    expect(describeMcpFailure('unauthorized', 'The MCP server rejected the token.'))
      .toMatchObject({ retry: 'token', action: 'Try another token' });
    expect(describeMcpFailure('unauthorized', 'The MCP server rejected the token.').message)
      .toContain('The MCP server rejected the token.');
    expect(describeMcpFailure('unreachable', 'The MCP server could not be reached.').retry).toBe('attempt');
    expect(describeMcpFailure('oversized_schema', 'too big').retry).toBe('none');
    expect(describeMcpFailure('too_many_tools', 'too many').retry).toBe('none');
    // An unclassified failure is shown exactly as the server said it.
    expect(describeMcpFailure(undefined, 'Something odd happened.')).toEqual({ message: 'Something odd happened.', retry: 'attempt', action: 'Try again' });
  });
});
