import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectionsPage from '@/src/components/customize/ConnectionsPage';
import { resetMcpConnectionsCache } from '@/src/lib/client/mcp';
import { useAppStore } from '@/src/store/rootStore';
import type { McpConnectionView, McpToolView } from '@/src/types/mcp.types';
import type { User } from '@/src/types/user.types';

const tools: McpToolView[] = [
  { id: 'docs_search', name: 'docs_search', description: 'Search the docs.', readOnly: true, access: 'read', schemaBytes: 412, estimatedTokens: 180, enabled: true },
  { id: 'docs_write', name: 'docs_write', description: 'Write a page.', readOnly: false, access: 'write', schemaBytes: 180, estimatedTokens: 90, enabled: false },
];
const docs: McpConnectionView = {
  id: 'c1', name: 'Docs server', url: 'https://mcp.example.com/mcp', host: 'mcp.example.com',
  catalogId: null, transport: 'streamable_http', authMode: 'none', hasCredential: false, enabled: true,
  status: 'connected', lastError: null, lastCheckedAt: '2026-11-01T10:00:00.000Z',
  tools, toolCount: tools.length, needsReview: false,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
};

let connections: McpConnectionView[];
let fetcher: ReturnType<typeof vi.fn>;
const calls = (method: string, url: RegExp) => fetcher.mock.calls.filter(([input, init]) =>
  (init as RequestInit | undefined)?.method === method && url.test(String(input)));

/**
 * Motion caches its reduced-motion reading globally the first time a component
 * asks, so this lives in its own file: the stub has to be in place before that
 * first read. Everything below asserts the promise the reference makes - travel,
 * height springs and the colour wash go away, while every state change and every
 * announcement still happens.
 */
beforeEach(() => {
  resetMcpConnectionsCache();
  window.history.replaceState(null, '', '/customize/connections');
  useAppStore.setState({ user: { id: 'user-1', name: 'Ada' } as User, drafts: {}, draftsOwner: 'user-1' });
  connections = [{ ...docs }];
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    // motion-dom asks for "(prefers-reduced-motion)"; answer any spelling of it.
    matches: query.startsWith('(prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia);
  fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/mcp/connections' && method === 'GET') return Response.json({ connections, limit: 10 });
    const match = url.match(/^\/api\/mcp\/connections\/([^/]+)$/);
    if (match && method === 'PATCH') {
      const patch = JSON.parse((init as RequestInit).body as string);
      connections = connections.map((connection) => (connection.id === match[1]
        ? { ...connection, tools: connection.tools.map((tool) => (patch.toolEnabled?.[tool.id] === undefined ? tool : { ...tool, enabled: patch.toolEnabled[tool.id] })) }
        : connection));
      return Response.json({ connection: connections.find((connection) => connection.id === match[1]) });
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

describe('the MCP servers block under reduced motion', () => {
  it('opens a row with no chevron travel, no height spring and no colour wash', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    const trigger = await screen.findByRole('button', { name: /^Docs server, Connected/ });
    const row = document.querySelector<HTMLElement>('[data-row-id="c1"]')!;
    expect(row.className).not.toContain('transition-colors');

    await user.click(trigger);
    expect(await screen.findByRole('region', { name: 'Docs server details' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const chevron = trigger.querySelector('svg')!;
    expect(chevron.getAttribute('class')).toContain('rotate-90');
    expect(chevron.getAttribute('class')).not.toContain('transition-transform');
    // The endpoint and the tool list arrive, animated or not.
    expect(within(screen.getByRole('region', { name: 'Docs server details' })).getByText('https://mcp.example.com/mcp')).toBeInTheDocument();
  });

  it('keeps every state change and announcement: switch, meter, undo bar', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);
    await user.click(await screen.findByRole('button', { name: /^Docs server, Connected/ }));
    const tool = await screen.findByRole('switch', { name: 'Enable docs_write on Docs server' });
    await user.click(tool);
    expect(calls('PATCH', /\/api\/mcp\/connections\/c1$/)).toHaveLength(1);
    await waitForChecked(tool, 'true');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '270');
    expect(screen.getByText(/docs_write on Docs server turned on/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Docs server' }));
    const bar = screen.getByRole('group', { name: 'Removing Docs server' });
    // The countdown bar appears inside the block without its slide, and its drain
    // line does not animate: the state change is the announcement, not the motion.
    expect(within(block()).getByRole('meter')).toBeInTheDocument();
    expect(bar.className).not.toContain('transition-');
    expect(bar.querySelector('.origin-left')?.getAttribute('class')).not.toContain('transition-[width]');
    expect(within(bar).getByText(/deleted in about 6 seconds/)).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('group', { name: /Removing/ })).toBeNull();
    expect(screen.getByText(/Docs server kept\. Nothing was deleted\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Docs server, Connected/ })).toBeInTheDocument();
  });
});

/** The merged PATCH answer drives the switch, so wait for the store round trip. */
async function waitForChecked(element: HTMLElement, value: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (element.getAttribute('aria-checked') === value) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`aria-checked never became ${value}`);
}
