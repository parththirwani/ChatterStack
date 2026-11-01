'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { useAppStore } from '@/src/store/rootStore';
import { formatMeterTokens } from '@/src/lib/client/mcp-budget';
import { MAX_TOKEN_LENGTH } from '@/src/lib/client/mcp-validation';
import type { McpConnectionView, McpToolView } from '@/src/types/mcp.types';
import { updateMcpConnection, useMcpConnections } from '@/src/lib/client/mcp';
import AddServerSheet from './connections/AddServerSheet';
import ContextMeter from './connections/ContextMeter';
import ServerRow from './connections/ServerRow';
import UndoBar from './connections/UndoBar';
import { useUndoableRemoval } from './connections/useUndoableRemoval';
import { PageHeaderToggle } from './SkillsPage';
import CustomizeTabs from './CustomizeTabs';

/** How long a freshly added row stays lit after the add-server sheet closes. */
export const JUST_ADDED_HIGHLIGHT_MS = 2_000;

/** Token entry, shared by the row's "Token" button and the catalog connect step. */
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

/** Customize → Connections: the MCP servers management block and its add-server sheet. */
export default function ConnectionsPage() {
  const userId = useAppStore((state) => state.user?.id);
  const { connections, limit, loading, error } = useMcpConnections(userId);
  const [actionError, setActionError] = useState('');
  const [live, setLive] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tokenFor, setTokenFor] = useState<McpConnectionView | null>(null);
  // The server that just arrived (lit, sliding in) and the one the sheet asked us to
  // show. The hand-off waits for `sheetOpen` to be false so the sheet's own focus
  // restoration (back to the trigger) cannot land after it.
  const [addedId, setAddedId] = useState<string | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

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

  // A connection the list has never shown is the one that just arrived: it slides in
  // and stays lit, so adding a server is visible even while the sheet covers the card.
  // The very first list of the session only primes the set - existing servers must
  // not light up, and nothing may take focus, just because the page opened.
  const seenIds = useRef(new Set<string>());
  const primedList = useRef(false);
  useEffect(() => {
    if (loading) return;
    const known = seenIds.current;
    if (connections.length === 0) {
      known.clear();
      primedList.current = false;
      return;
    }
    const first = !primedList.current;
    primedList.current = true;
    const fresh = first ? [] : connections.map((connection) => connection.id).filter((id) => !known.has(id));
    connections.forEach((connection) => known.add(connection.id));
    if (fresh.length > 0) setAddedId(fresh[fresh.length - 1]);
  }, [connections, loading]);

  // The sheet asked to be shown its server: once it is out of the way, hand focus to
  // that row - once, however many refreshes follow.
  useEffect(() => {
    if (sheetOpen || !handoffId) return;
    if (!connections.some((connection) => connection.id === handoffId)) return;
    setHandoffId(null);
    listRef.current?.querySelector<HTMLElement>(`[data-row-id="${handoffId}"] [data-mcp-row-trigger]`)?.focus();
  }, [handoffId, connections, sheetOpen]);

  // The lit row fades a moment after the sheet closes, not while it is still open.
  useEffect(() => {
    if (!addedId || sheetOpen) return;
    const timer = setTimeout(() => setAddedId(null), JUST_ADDED_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [addedId, sheetOpen]);

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
    if (addedId === connection.id) setAddedId(null);
    if (handoffId === connection.id) setHandoffId(null);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#191919]">
      {/* The polite region stays outside the sheet's inert background, so announcements survive the modal. */}
      <p aria-live="polite" className="sr-only">{live}</p>
      <div data-mcp-page ref={pageRef} className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 sm:px-8">
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

        <section aria-label="MCP servers" className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <h2 ref={headingRef} tabIndex={-1} className="text-sm font-medium text-[#d8d5d1] outline-none">MCP servers</h2>
            {connections.length > 0 && (
              <span className="rounded-full bg-white/[0.07] px-1.5 text-[11px] text-[#aaa6a2]">{rows.length}{limit ? `/${limit}` : ''}</span>
            )}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              className="ml-auto flex items-center gap-1 rounded-lg border border-white/[0.1] px-2 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.07]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add server
            </button>
          </div>

          <ContextMeter connections={rows} />

          {loading ? (
            <p className="border-t border-white/[0.06] px-4 py-6 text-sm text-[#aaa6a2]">Loading connections…</p>
          ) : rows.length === 0 ? (
            <div className="border-t border-white/[0.06] px-6 py-10 text-center">
              <p className="text-base text-[#e5e2de]">No servers yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-[#aaa6a2]">
                Use <span className="text-[#d7d4d0]">Add server</span> to pick one from the directory, or point ChatterStack at any
                Streamable HTTP MCP server by URL.
              </p>
            </div>
          ) : (
            <ul ref={listRef} onKeyDown={onListKeyDown} className="border-t border-white/[0.06]">
              {rows.map((connection) => (
                <ServerRow
                  key={connection.id}
                  connection={connection}
                  expanded={expandedIds.includes(connection.id)}
                  entering={connection.id === addedId}
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
      </div>

      {sheetOpen && (
        <AddServerSheet
          backgroundRef={pageRef}
          limit={limit}
          atLimit={atLimit}
          announce={announce}
          onClose={() => setSheetOpen(false)}
          onConnected={(connection) => {
            // Closing first lets the sheet put focus back where it started, and the
            // effect above then moves it from the trigger onto the new row.
            setSheetOpen(false);
            setHandoffId(connection.id);
            announce(`${connection.name} is in your list, switched off, with every tool off until you review it.`);
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
