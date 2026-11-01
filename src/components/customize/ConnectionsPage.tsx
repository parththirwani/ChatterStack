'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlugZap } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { useAppStore } from '@/src/store/rootStore';
import { MCP_CATALOG, type McpCatalogEntry } from '@/src/config/mcp-catalog';
import { formatMeterTokens } from '@/src/lib/client/mcp-budget';
import type { McpConnectionView, McpToolView } from '@/src/types/mcp.types';
import { createMcpConnection, updateMcpConnection, useMcpConnections } from '@/src/lib/client/mcp';
import ContextMeter from './connections/ContextMeter';
import ServerRow from './connections/ServerRow';
import UndoBar from './connections/UndoBar';
import { useUndoableRemoval } from './connections/useUndoableRemoval';
import { PageHeaderToggle } from './SkillsPage';
import CustomizeTabs from './CustomizeTabs';

const MAX_URL_LENGTH = 2_048;
const MAX_TOKEN_LENGTH = 4_096;

/** Mirrors the server's URL rules early, so a typo never leaves the browser. */
export function validateConnectionForm({ name, url }: { name: string; url: string }): { field: 'name' | 'url'; message: string } | null {
  if (!name.trim()) return { field: 'name', message: 'Give this connection a name.' };
  if (!url.trim()) return { field: 'url', message: 'Give the server URL.' };
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { field: 'url', message: 'That is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:') return { field: 'url', message: 'MCP servers must use HTTPS.' };
  if (parsed.username || parsed.password) return { field: 'url', message: 'Put credentials in the token field, not in the URL.' };
  if (url.trim().length > MAX_URL_LENGTH) return { field: 'url', message: `Keep the URL under ${MAX_URL_LENGTH} characters.` };
  return null;
}

/** Token entry, shared by the custom form, the catalog and the row's "Token" button. */
export function TokenDialog({
  title,
  forConnection,
  hasToken,
  required,
  onClose,
  onSubmit,
}: {
  title: string;
  forConnection?: string;
  hasToken: boolean;
  required: boolean;
  onClose: () => void;
  onSubmit: (token: string | null) => Promise<void>;
}) {
  const ref = useRef<HTMLElement>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useModalFocus(true, onClose, ref);

  const submit = async (clear: boolean) => {
    if (clear) {
      setBusy(true);
      try {
        await onSubmit(null);
        onClose();
      } catch (failure) {
        setError((failure as Error).message);
        setBusy(false);
      }
      return;
    }
    const value = token.trim();
    if (!value) {
      setError(required ? 'This server needs a token. Paste it first.' : 'Enter a token, or Remove token to clear it.');
      return;
    }
    if (value.length > MAX_TOKEN_LENGTH) {
      setError(`Keep the token under ${MAX_TOKEN_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(value);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="mcp-token-title" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#202020] p-5 shadow-2xl">
        <h2 id="mcp-token-title" className="text-base font-medium text-white">{title}</h2>
        <p className="mt-1 text-xs text-[#aaa6a2]">
          {forConnection ? `${forConnection} · ` : ''}Stored encrypted on the server and sent only to this URL as a bearer token.
        </p>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-[#aaa6a2]">{hasToken ? 'New token' : 'Token'}</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="Token"
            value={token}
            maxLength={MAX_TOKEN_LENGTH + 1}
            onChange={(event) => { setToken(event.target.value); setError(''); }}
            className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 font-mono text-sm text-white focus:border-white/30 focus:outline-none"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          {hasToken && (
            <button type="button" onClick={() => void submit(true)} disabled={busy} className="mr-auto text-sm text-[#aaa6a2] underline underline-offset-2 hover:text-white disabled:opacity-50">
              Remove token
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">Cancel</button>
          <button type="button" onClick={() => void submit(false)} disabled={busy} className="rounded-lg bg-[#f0eeeb] px-3 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Save token'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Catalog entry labels: whose token it needs, and whether it was verified. */
export function catalogAuthLabel(entry: McpCatalogEntry) {
  if (entry.auth === 'none') return 'No token needed';
  return entry.credentialOwner === 'user' ? 'Needs your own token' : 'Needs a token';
}

function CatalogCard({ entry, busy, onConnect }: { entry: McpCatalogEntry; busy: boolean; onConnect: (entry: McpCatalogEntry) => void }) {
  return (
    <li className="flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[#aaa6a2]"><PlugZap className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-[#eee]">{entry.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#aaa6a2]">{entry.blurb}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 pl-12">
        <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-[#aaa6a2]">{catalogAuthLabel(entry)}</span>
        <span className="flex-1 text-[11px] text-[#8f8b86]">
          {entry.verified ? `Verified ${entry.verified.at}${entry.verified.anonymous ? ' anonymously' : ''}` : 'Not verified yet'}
        </span>
        <a href={entry.docsUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#8f8b86] underline underline-offset-2 hover:text-white">Docs</a>
        <button
          type="button"
          onClick={() => onConnect(entry)}
          disabled={busy}
          aria-label={`Connect ${entry.name}`}
          className="rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.07] disabled:opacity-50"
        >
          {entry.auth === 'bearer' ? 'Connect with token' : 'Connect'}
        </button>
      </div>
    </li>
  );
}

/** Customize → Connections: the MCP servers management block, catalog and custom server. */
export default function ConnectionsPage() {
  const userId = useAppStore((state) => state.user?.id);
  const { connections, limit, loading, error } = useMcpConnections(userId);
  const [actionError, setActionError] = useState('');
  const [live, setLive] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [formToken, setFormToken] = useState('');
  const [formError, setFormError] = useState('');
  const [catalogTokenFor, setCatalogTokenFor] = useState<McpCatalogEntry | null>(null);
  const [tokenFor, setTokenFor] = useState<McpConnectionView | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const announce = useCallback((message: string) => setLive(message), []);
  const fail = useCallback((message: string) => setActionError(message), []);
  const removal = useUndoableRemoval({ announce, fail });

  // A removal hides its row the moment the bar opens; a committed one stays
  // hidden through the refresh that confirms it. Undo brings the row straight back.
  const hiddenIds = new Set(removal.committed);
  if (removal.pending) hiddenIds.add(removal.pending.connection.id);
  const rows = connections.filter((connection) => !hiddenIds.has(connection.id));
  const pruneCommitted = removal.pruneCommitted;
  useEffect(() => { pruneCommitted(connections.map((connection) => connection.id)); }, [connections, pruneCommitted]);

  const atLimit = limit > 0 && connections.length >= limit;

  const onAction = (work: () => Promise<unknown>) => {
    setActionError('');
    work().catch((failure: Error) => {
      setActionError(failure.message);
      announce(`Failed: ${failure.message}`);
    });
  };

  const setRowExpanded = (id: string, expanded: boolean) =>
    setExpandedIds((ids) => (expanded ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((held) => held !== id)));

  const toggleConnection = (connection: McpConnectionView) =>
    onAction(async () => {
      await updateMcpConnection(connection.id, { enabled: !connection.enabled });
      announce(connection.enabled
        ? `${connection.name} turned off. Its tool switches went off with it.`
        : `${connection.name} turned on. No tool is on yet; open it and review.`);
    });

  const toggleTool = (connection: McpConnectionView, tool: McpToolView) =>
    onAction(async () => {
      const turningOn = !tool.enabled;
      const body = await updateMcpConnection(connection.id, { toolEnabled: { [tool.id]: turningOn } });
      const estimate = body.connection.tools.find((held) => held.id === tool.id)?.estimatedTokens;
      announce(`${tool.name} on ${connection.name} turned ${turningOn ? 'on' : 'off'}.${estimate !== null && estimate !== undefined ? ` About ${formatMeterTokens(estimate)} estimated tokens.` : ''}`);
    });

  const startRemoval = (connection: McpConnectionView) => {
    const active = document.activeElement;
    const focusWasInRow = active instanceof HTMLElement && Boolean(active.closest(`[data-row-id="${connection.id}"]`));
    removal.start(connection);
    announce(`Removing ${connection.name}. Undo is available for a few seconds, or press Control or Command plus Z to bring the bar back.`);
    // Whatever held focus is vanishing with the row: hand focus to the block heading.
    if (focusWasInRow) headingRef.current?.focus();
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const triggers = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-mcp-row-trigger]') ?? []);
    if (triggers.length === 0) return;
    event.preventDefault();
    const index = triggers.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? triggers.length - 1
      : event.key === 'ArrowDown' ? Math.min(index + 1, triggers.length - 1)
      : Math.max(index - 1, 0);
    triggers[index === -1 ? 0 : next]?.focus();
  };

  const connectCatalog = async (entry: McpCatalogEntry, token?: string) => {
    setActionError('');
    try {
      await createMcpConnection({ name: entry.name, catalogId: entry.id, ...(token ? { token } : {}) });
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  const addCustom = async () => {
    const problem = validateConnectionForm({ name, url });
    if (problem) {
      setFormError(problem.message);
      return;
    }
    const token = formToken.trim();
    if (token.length > MAX_TOKEN_LENGTH) {
      setFormError(`Keep the token under ${MAX_TOKEN_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await createMcpConnection({ name: name.trim(), url: url.trim(), ...(token ? { token } : {}) });
      setName('');
      setUrl('');
      setFormToken('');
    } catch (failure) {
      setFormError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#191919]">
      <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 sm:px-8">
        <div className="flex items-center">
          <PageHeaderToggle />
          <h1 className="text-2xl font-medium text-white">Customize</h1>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <CustomizeTabs active="connections" />
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#aaa6a2]">
          Connect a remote MCP server to let your chats use its tools. Nothing runs on its own: a tool is
          offered to the model only if you switch it on, and every call waits for your approval in the chat
          — there is no &ldquo;always allow&rdquo;, not even for read-only tools.
          Council and scheduled tasks never use MCP tools.
        </p>

        {(error || actionError) && <p role="alert" className="mt-4 text-sm text-red-300">{actionError || error}</p>}
        <p aria-live="polite" className="sr-only">{live}</p>

        <section aria-label="MCP servers" className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <h2 ref={headingRef} tabIndex={-1} className="text-sm font-medium text-[#d8d5d1] outline-none">MCP servers</h2>
            {connections.length > 0 && (
              <span className="rounded-full bg-white/[0.07] px-1.5 text-[11px] text-[#aaa6a2]">{rows.length}{limit ? `/${limit}` : ''}</span>
            )}
            <span className="ml-auto hidden text-[11px] text-[#8f8b86] min-[400px]:inline">Removal waits a few seconds and can be undone.</span>
          </div>

          <ContextMeter connections={rows} />

          {loading ? (
            <p className="border-t border-white/[0.06] px-4 py-6 text-sm text-[#aaa6a2]">Loading connections…</p>
          ) : rows.length === 0 ? (
            <div className="border-t border-white/[0.06] px-6 py-10 text-center">
              <p className="text-base text-[#e5e2de]">No connections yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-[#aaa6a2]">Pick one from the catalog below, or add any Streamable HTTP MCP server by URL.</p>
            </div>
          ) : (
            <ul ref={listRef} onKeyDown={onListKeyDown} className="border-t border-white/[0.06]">
              {rows.map((connection) => (
                <ServerRow
                  key={connection.id}
                  connection={connection}
                  expanded={expandedIds.includes(connection.id)}
                  onExpandedChange={(expanded) => setRowExpanded(connection.id, expanded)}
                  onToggleConnection={() => toggleConnection(connection)}
                  onToggleTool={(tool) => toggleTool(connection, tool)}
                  onReviewTools={() => onAction(() => updateMcpConnection(connection.id, { reviewTools: true }))}
                  onRequestToken={() => setTokenFor(connection)}
                  onRequestRemove={() => startRemoval(connection)}
                  announce={announce}
                />
              ))}
            </ul>
          )}

          {removal.pending && !removal.pending.hidden && (
            <UndoBar
              pending={removal.pending}
              getRemaining={removal.getRemaining}
              windowMs={removal.windowMs}
              onUndo={removal.undo}
              onHide={removal.hide}
              onPauseSource={removal.setPauseSource}
            />
          )}
        </section>

        <section aria-label="Catalog" className="mt-8">
          <h2 className="mb-2 px-3 text-sm font-medium text-[#d8d5d1]">Catalog</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {MCP_CATALOG.map((entry) => (
              <CatalogCard
                key={entry.id}
                entry={entry}
                busy={busy || catalogTokenFor !== null || atLimit}
                onConnect={(item) => {
                  if (item.auth === 'bearer') setCatalogTokenFor(item);
                  else onAction(() => connectCatalog(item));
                }}
              />
            ))}
          </ul>
          {atLimit && <p className="mt-2 text-xs text-[#aaa6a2]">You can keep up to {limit} connections. Delete one to add another.</p>}
        </section>

        <section aria-label="Add a custom server" className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <h2 className="text-sm font-medium text-[#d8d5d1]">Add a custom server</h2>
          <p className="mt-1 text-xs text-[#aaa6a2]">Any remote MCP server over Streamable HTTP. HTTPS only, no credentials in the URL.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
            <div>
              <input
                aria-label="Connection name"
                aria-invalid={formError.includes('name') ? true : undefined}
                placeholder="My server"
                value={name}
                maxLength={60}
                onChange={(event) => { setName(event.target.value); setFormError(''); }}
                className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 text-sm text-white placeholder:text-[#8a8681] focus:border-white/30 focus:outline-none"
              />
            </div>
            <div>
              <input
                aria-label="Server URL"
                aria-invalid={formError.includes('URL') || formError.includes('HTTPS') ? true : undefined}
                placeholder="https://mcp.example.com/mcp"
                value={url}
                maxLength={MAX_URL_LENGTH}
                onChange={(event) => { setUrl(event.target.value); setFormError(''); }}
                className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 font-mono text-sm text-white placeholder:text-[#8a8681] focus:border-white/30 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void addCustom()}
              disabled={busy}
              className="h-9 rounded-lg bg-[#f0eeeb] px-4 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
          <div className="mt-3">
            <input
              type="password"
              aria-label="Bearer token (optional)"
              autoComplete="off"
              spellCheck={false}
              placeholder="Bearer token (optional)"
              value={formToken}
              maxLength={MAX_TOKEN_LENGTH + 1}
              onChange={(event) => { setFormToken(event.target.value); setFormError(''); }}
              className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 font-mono text-sm text-white placeholder:font-sans placeholder:text-[#8a8681] focus:border-white/30 focus:outline-none"
            />
          </div>
          {formError && <p role="alert" className="mt-2 text-xs text-red-300">{formError}</p>}
        </section>
      </div>

      {catalogTokenFor && (
        <TokenDialog
          title={`Connect ${catalogTokenFor.name}`}
          forConnection={new URL(catalogTokenFor.url).host}
          hasToken={false}
          required
          onClose={() => setCatalogTokenFor(null)}
          onSubmit={async (token) => {
            if (!token) throw new Error('This server needs a token.');
            await connectCatalog(catalogTokenFor, token);
          }}
        />
      )}
      {tokenFor && (
        <TokenDialog
          title={`${tokenFor.hasCredential ? 'Change' : 'Add'} token`}
          forConnection={tokenFor.name}
          hasToken={tokenFor.hasCredential}
          required={tokenFor.authMode === 'bearer'}
          onClose={() => setTokenFor(null)}
          onSubmit={async (token) => {
            await updateMcpConnection(tokenFor.id, token === null ? { clearToken: true } : { token });
            setLive(`Token ${token === null ? 'removed from' : 'saved for'} ${tokenFor.name}.`);
          }}
        />
      )}
    </div>
  );
}
