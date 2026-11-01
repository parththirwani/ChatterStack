import React, { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddServerSheet from '@/src/components/customize/connections/AddServerSheet';
import { resetMcpConnectionsCache } from '@/src/lib/client/mcp';
import type { McpConnectionView, McpToolView } from '@/src/types/mcp.types';

const tools: McpToolView[] = [
  { id: 'search_cloudflare_documentation', name: 'search_cloudflare_documentation', description: 'Search the Cloudflare docs.', readOnly: true, access: 'read', schemaBytes: 412, estimatedTokens: 180, enabled: false },
  { id: 'fetch_url', name: 'fetch_url', description: 'Fetch one page.', readOnly: false, access: 'write', schemaBytes: 180, estimatedTokens: 96, enabled: false },
];

const created: McpConnectionView = {
  id: 'c9', name: 'Cloudflare documentation', url: 'https://docs.mcp.cloudflare.com/mcp', host: 'docs.mcp.cloudflare.com',
  catalogId: 'cloudflare-docs', transport: 'streamable_http', authMode: 'none', hasCredential: false, enabled: false,
  status: 'connected', lastError: null, lastCheckedAt: '2026-11-01T10:00:00.000Z',
  tools, toolCount: tools.length, needsReview: true, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
};

/**
 * Motion caches its reduced-motion reading globally the first time a component asks,
 * so this lives in its own file: the stub has to be in place before that first read.
 */
function Harness() {
  const backgroundRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={backgroundRef} data-testid="background">
        <button type="button">Behind the sheet</button>
      </div>
      <AddServerSheet
        backgroundRef={backgroundRef}
        onConnected={() => {}}
        onClose={() => {}}
        announce={() => {}}
        atLimit={false}
        limit={10}
      />
    </>
  );
}

/** Lets the test decide when the discovery answer comes back. */
let releaseTest: () => void = () => {};
const holdReleased = new Promise<void>((resolve) => { releaseTest = resolve; });

beforeEach(() => {
  resetMcpConnectionsCache();
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
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/mcp/connections' && method === 'POST') return Response.json({ connection: created }, { status: 201 });
    if (url === `/api/mcp/connections/${created.id}/test` && method === 'POST') {
      // Hold the discovery answer so the connecting phase can be looked at.
      await holdReleased;
      return Response.json({ connection: { ...created, tools, toolCount: tools.length, needsReview: true }, ok: true });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the add-server sheet under reduced motion', () => {
  it('lands every discovered tool at once and says so', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await screen.findByRole('dialog', { name: 'Add a server' });
    await user.click(within(dialog).getByRole('option', { name: /Cloudflare documentation/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Connect to docs.mcp.cloudflare.com' }));

    // While it works there is a spinner in the DOM, and it does not spin.
    await within(dialog).findByText('Connecting and asking for its tools…');
    const spinner = within(dialog).getByRole('status').querySelector('svg')!;
    expect(spinner.getAttribute('class')).not.toContain('animate-spin');
    // Let discovery answer inside act, so the state it lands in is flushed.
    await act(async () => { releaseTest(); });

    const found = await screen.findByRole('list', { name: 'Discovered tools' });
    expect(within(found).getByText('search_cloudflare_documentation')).toBeInTheDocument();
    expect(within(found).getByText('fetch_url')).toBeInTheDocument();
    expect(within(dialog).queryByText(/more arriving/)).toBeNull();
    expect(within(dialog).getByText(/Every tool arrived off/)).toBeInTheDocument();
    // The sheet still parks everything behind it out of the tab order and the a11y tree.
    expect(screen.getByTestId('background')).toHaveAttribute('inert');
    expect(screen.getByTestId('background').getAttribute('inert')).toBe('');
  });
});
