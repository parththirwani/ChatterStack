'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Link2, Loader2, PenLine, PlugZap, Search, ShieldCheck, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { MCP_CATALOG, type McpCatalogEntry } from '@/src/config/mcp-catalog';
import { createMcpConnection, testMcpConnection, updateMcpConnection, McpApiError } from '@/src/lib/client/mcp';
import { describeMcpFailure, type McpFailureGuide } from '@/src/lib/client/mcp-failure';
import { formatMeterTokens } from '@/src/lib/client/mcp-budget';
import {
  MAX_NAME_LENGTH,
  MAX_TOKEN_LENGTH,
  MAX_URL_LENGTH,
  catalogAuthLabel,
  catalogAuthStatement,
  filterCatalog,
  validateConnectionForm,
} from '@/src/lib/client/mcp-validation';
import type { McpConnectionView, McpToolView } from '@/src/types/mcp.types';
import HideOnNarrow from './HideOnNarrow';

/** How long one discovered tool waits before the next one lands. */
export const TOOL_REVEAL_MS = 120;

type SheetStep = 'pick' | 'custom' | 'auth' | 'connect';
type ConnectPhase = 'idle' | 'creating' | 'testing' | 'streaming' | 'ready';

interface SheetFailure {
  guide: McpFailureGuide;
  /** Which call failed, because that decides what a retry may reuse. */
  stage: 'create' | 'test';
}

/**
 * What the sheet is about to connect. `token` is `required` for a catalog entry
 * that cannot answer without one, `optional` for a server that might, and `never`
 * for the public entry - so the auth step can state the truth instead of guessing.
 */
export interface AddTarget {
  name: string;
  host: string;
  statement: string;
  token: 'required' | 'optional' | 'never';
  url?: string;
  catalogId?: string;
  /** Where the person reads up on the credential, when the catalog knows. */
  docsUrl?: string;
}

function catalogTarget(entry: McpCatalogEntry): AddTarget {
  return {
    name: entry.name,
    host: new URL(entry.url).host,
    statement: catalogAuthStatement(entry),
    token: entry.auth === 'none' ? 'never' : 'required',
    catalogId: entry.id,
    docsUrl: entry.docsUrl,
  };
}

const guideFor = (failure: unknown): McpFailureGuide => {
  const error = failure as McpApiError;
  return describeMcpFailure(error?.code, error?.message ?? 'Something went wrong. Try again.');
};

export interface AddServerSheetProps {
  /** The content behind the sheet; it goes inert while the sheet is open. */
  backgroundRef: React.RefObject<HTMLDivElement | null>;
  /** Closing after a connect hands the new server to the block, which focuses it. */
  onConnected: (connection: McpConnectionView) => void;
  onClose: () => void;
  announce: (message: string) => void;
  atLimit: boolean;
  limit: number;
}

/**
 * The add-server sheet: a searchable directory of the real catalog, a custom
 * HTTPS URL field with the same validation as the server's own rules, an honest
 * statement of whose token is needed, live progress while the real API works, and
 * the discovered tools landing one by one.
 *
 * Nothing is simulated and nothing is enabled here: the connection is created off
 * and untested, the tools come from the real `tools/list` answer, and each one
 * starts disabled and stays that way until it is reviewed in the list - reads
 * included, because ChatterStack has no &ldquo;always allow&rdquo;. Closing the
 * sheet part way leaves exactly what the server already knows (an off connection,
 * possibly with a stored error), never a half-connected ghost.
 */
export default function AddServerSheet({ backgroundRef, onConnected, onClose, announce, atLimit, limit }: AddServerSheetProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState<SheetStep>('pick');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<AddTarget | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState('');
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [created, setCreated] = useState<McpConnectionView | null>(null);
  const [failure, setFailure] = useState<SheetFailure | null>(null);
  const [tools, setTools] = useState<McpToolView[]>([]);
  const [shown, setShown] = useState(0);

  // Declared before the focus hook on purpose: its cleanup runs first, so the
  // card is not inert any more by the time focus is handed back to its trigger.
  useEffect(() => {
    const background = backgroundRef.current;
    background?.setAttribute('inert', '');
    return () => background?.removeAttribute('inert');
  }, [backgroundRef]);

  useModalFocus(true, onClose, ref, searchRef);

  // Every step change puts a screen reader on the new heading inside the sheet.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const entries = useMemo(() => filterCatalog(MCP_CATALOG, query), [query]);
  const connecting = phase === 'creating' || phase === 'testing';

  // Tools land one by one from the real listTools answer. With reduce-motion the
  // same state changes happen at once instead of arriving on a timer.
  useEffect(() => {
    if (phase !== 'streaming') return;
    if (reduceMotion || shown >= tools.length) {
      if (shown < tools.length) setShown(tools.length);
      setPhase('ready');
      const found = tools.length;
      announce(found === 0
        ? 'The server answered but offers no tools. Nothing was switched on.'
        : `${found} ${found === 1 ? 'tool' : 'tools'} discovered. Every one of them is off until you review it.`);
      return;
    }
    const timer = setTimeout(() => setShown((count) => count + 1), TOOL_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [phase, shown, tools.length, reduceMotion, announce]);

  /** The real API: create the connection, then let the server discover its tools. */
  const start = useCallback(async (which: AddTarget, bearer: string, reuse: McpConnectionView | null) => {
    if (which.token === 'required' && !bearer) {
      setFailure({ guide: { message: 'This server needs your token before it will answer.', retry: 'token', action: 'Enter your token' }, stage: 'create' });
      setStep('auth');
      return;
    }
    setFailure(null);
    setStep('connect');
    let connection = reuse;
    if (!connection) {
      setPhase('creating');
      try {
        connection = await createMcpConnection({
          name: which.name,
          ...(which.catalogId ? { catalogId: which.catalogId } : { url: which.url ?? '' }),
          ...(bearer ? { token: bearer } : {}),
        });
      } catch (error) {
        setFailure({ guide: guideFor(error), stage: 'create' });
        setPhase('idle');
        return;
      }
      setCreated(connection);
      announce(`${which.name} added, switched off.`);
    } else if (bearer) {
      // A retry after a refused token puts the new token on the connection that
      // already exists, rather than starting a second one.
      setPhase('creating');
      try {
        const rotated = await updateMcpConnection(connection.id, { token: bearer });
        connection = rotated.connection;
        setCreated(connection);
      } catch (error) {
        setFailure({ guide: guideFor(error), stage: 'create' });
        setPhase('idle');
        return;
      }
    }
    setPhase('testing');
    try {
      const result = await testMcpConnection(connection.id);
      if (!result.ok) {
        setFailure({ guide: describeMcpFailure(result.code, result.error ?? 'The server did not answer.'), stage: 'test' });
        setPhase('idle');
        return;
      }
      setTools(result.connection.tools);
      setShown(reduceMotion ? result.connection.tools.length : 0);
      setPhase('streaming');
    } catch (error) {
      setFailure({ guide: guideFor(error), stage: 'test' });
      setPhase('idle');
    }
  }, [announce, reduceMotion]);

  /**
   * Retry honestly: a refused token goes back to the token step, anything else
   * re-runs the attempt on the connection that already exists - it never creates
   * a second row for the same server.
   */
  const retry = useCallback(() => {
    if (!target) return;
    if (failure?.guide.retry === 'token') {
      // The refused token is dropped, so pasting the right one needs no editing.
      setFailure(null);
      setToken('');
      setStep('auth');
      return;
    }
    void start(target, created ? '' : token.trim(), created);
  }, [created, failure, start, target, token]);

  const chooseEntry = (entry: McpCatalogEntry) => {
    setTarget(catalogTarget(entry));
    setToken('');
    setFailure(null);
    setStep('auth');
  };

  const submitCustom = () => {
    const problem = validateConnectionForm({ name, url });
    if (problem) {
      setFormError(problem.message);
      return;
    }
    const bearer = token.trim();
    if (bearer.length > MAX_TOKEN_LENGTH) {
      setFormError(`Keep the token under ${MAX_TOKEN_LENGTH} characters.`);
      return;
    }
    const host = new URL(url.trim()).host;
    setFormError('');
    setTarget({
      name: name.trim(),
      host,
      url: url.trim(),
      token: bearer ? 'required' : 'optional',
      statement: bearer
        ? `ChatterStack stores this token encrypted for this connection only and sends it just to ${host} - never to another server, another user, or the model.`
        : `No token has been given, so nothing is sent to ${host} but the URL itself. Add one below if the server asks for it.`,
    });
    setStep('auth');
  };

  const onEntryKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') return;
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-directory-entry]') ?? []);
    if (options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[Math.min(index + 1, options.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0) searchRef.current?.focus();
      else options[index - 1]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      options[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      options[options.length - 1]?.focus();
    }
  };

  /** Back: leaving the connect attempt resets it, so a later Connect starts clean. */
  const back = (next: SheetStep) => {
    setStep(next);
    setFailure(null);
    setPhase('idle');
    if (next === 'pick') {
      setTarget(null);
      setCreated(null);
      setTools([]);
      setShown(0);
      setToken('');
    }
  };

  const heading = step === 'pick' ? 'Add a server'
    : step === 'custom' ? 'Add a server by URL'
    : step === 'auth' ? `Connect ${target?.name ?? ''}`
    : created?.name ?? target?.name ?? 'Connecting';

  return createPortal(
    <div className="fixed inset-0 z-[110] flex justify-end bg-black/70">
      <motion.section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-add-title"
        initial={reduceMotion ? false : { x: '100%' }}
        animate={{ x: 0 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', visualDuration: 0.4, bounce: 0 }}
        className="flex h-full w-full max-w-md flex-col border-l border-white/[0.08] bg-[#1f1f1f] shadow-2xl"
      >
        <header className="flex items-start gap-2 border-b border-white/[0.06] px-4 py-4 min-[400px]:px-5">
          {step !== 'pick' && step !== 'connect' && (
            <button
              type="button"
              onClick={() => back(step === 'custom' ? 'pick' : target?.url ? 'custom' : 'pick')}
              aria-label="Back"
              className="mt-0.5 shrink-0 rounded-md p-1 text-[#aaa6a2] hover:bg-white/[0.07] hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="mcp-add-title" ref={headingRef} tabIndex={-1} className="truncate text-base font-medium text-white outline-none">{heading}</h2>
            {target && step !== 'pick' && (
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[#8f8b86]">
                <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">Endpoint</span>
                <span className="break-all font-mono">{target.url ?? target.host}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-[#aaa6a2] hover:bg-white/[0.07] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 min-[400px]:px-5">
          {atLimit && step === 'pick' && (
            <p className="mb-3 rounded-lg border border-amber-300/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-[#e6d9b8]">
              You can keep up to {limit} connections. Remove one to add another.
            </p>
          )}

          {step === 'pick' && (
            <>
              <span className="mb-1 block text-xs text-[#aaa6a2]" id="mcp-directory-search-label">Search the directory</span>
              <span className="flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 focus-within:border-white/30">
                <Search className="h-4 w-4 shrink-0 text-[#8f8b86]" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown') return;
                    event.preventDefault();
                    listRef.current?.querySelector<HTMLElement>('[data-directory-entry]')?.focus();
                  }}
                  aria-labelledby="mcp-directory-search-label"
                  aria-controls="mcp-directory"
                  placeholder="Search by name, host or what it does"
                  className="h-9 w-full bg-transparent text-sm text-white placeholder:text-[#8a8681] focus:outline-none"
                />
              </span>

              <ul id="mcp-directory" ref={listRef} role="listbox" aria-label="MCP directory" className="mt-3 space-y-2">
                {entries.map((entry, index) => (
                  <li key={entry.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      data-directory-entry
                      tabIndex={index === 0 ? 0 : -1}
                      onKeyDown={(event) => onEntryKeyDown(event, index)}
                      onClick={() => chooseEntry(entry)}
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                    >
                      <span className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[#aaa6a2]"><PlugZap className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-[#eee]">{entry.name}</span>
                            <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-[#aaa6a2]">{catalogAuthLabel(entry)}</span>
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[#aaa6a2]">{entry.blurb}</span>
                          <span className="mt-1 block text-[11px] text-[#8f8b86]">
                            {entry.verified
                              ? `Verified ${entry.verified.at}${entry.verified.anonymous ? ' anonymously' : ''} · ${entry.verified.tools.length} ${entry.verified.tools.length === 1 ? 'tool' : 'tools'}`
                              : 'Not verified from this deployment yet'}
                          </span>
                        </span>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#8f8b86]" aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                ))}
                {entries.length === 0 && (
                  <li className="rounded-xl border border-dashed border-white/[0.12] px-3 py-4 text-sm text-[#aaa6a2]">
                    Nothing in the directory matches &ldquo;{query}&rdquo;.
                  </li>
                )}
              </ul>

              <button
                type="button"
                onClick={() => { setStep('custom'); setFormError(''); }}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
              >
                <Link2 className="h-4 w-4 shrink-0 text-[#aaa6a2]" aria-hidden="true" />
                <span className="flex-1 text-sm text-[#e5e2de]">Add any HTTPS MCP server by URL</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[#8f8b86]" aria-hidden="true" />
              </button>
            </>
          )}

          {step === 'custom' && (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-[#aaa6a2]">Any remote MCP server over Streamable HTTP. HTTPS only, and no credentials in the URL.</p>
              <label className="block text-sm">
                <span className="mb-1 block text-[#aaa6a2]">Name</span>
                <input
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  aria-invalid={formError.includes('name') ? true : undefined}
                  aria-label="Connection name"
                  placeholder="My server"
                  onChange={(event) => { setName(event.target.value); setFormError(''); }}
                  className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 text-sm text-white placeholder:text-[#8a8681] focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[#aaa6a2]">Server URL</span>
                <input
                  value={url}
                  maxLength={MAX_URL_LENGTH}
                  aria-invalid={/URL|HTTPS/.test(formError) ? true : undefined}
                  aria-label="Server URL"
                  placeholder="https://mcp.example.com/mcp"
                  onChange={(event) => { setUrl(event.target.value); setFormError(''); }}
                  className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 font-mono text-sm text-white placeholder:text-[#8a8681] focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[#aaa6a2]">Bearer token (only if this server needs one)</span>
                <input
                  type="password"
                  value={token}
                  maxLength={MAX_TOKEN_LENGTH + 1}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Bearer token (optional)"
                  onChange={(event) => { setToken(event.target.value); setFormError(''); }}
                  className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 font-mono text-sm text-white placeholder:font-sans placeholder:text-[#8a8681] focus:border-white/30 focus:outline-none"
                />
              </label>
              {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}
              <button
                type="button"
                onClick={submitCustom}
                className="w-full rounded-lg bg-[#f0eeeb] px-3 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'auth' && target && (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-[#d8d5d1]">{target.statement}</p>
              {target.token !== 'never' && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[#aaa6a2]">
                    {target.token === 'required' ? 'Your token (required)' : 'Your token (only if this server needs one)'}
                  </span>
                  <input
                    type="password"
                    value={token}
                    maxLength={MAX_TOKEN_LENGTH + 1}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Your token"
                    aria-required={target.token === 'required'}
                    aria-invalid={failure?.guide.retry === 'token' ? true : undefined}
                    onChange={(event) => { setToken(event.target.value); setFailure(null); }}
                    className="h-9 w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 font-mono text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
              )}
              {target.docsUrl && (
                <p className="text-xs text-[#aaa6a2]">
                  <a href={target.docsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">
                    {target.token === 'required' ? 'How to get this token' : 'About this server'}
                  </a>
                </p>
              )}
              {failure && failure.stage === 'create' && <p role="alert" className="text-xs leading-5 text-red-300">{failure.guide.message}</p>}
              <button
                type="button"
                disabled={atLimit}
                onClick={() => void start(target, target.token === 'never' ? '' : token.trim(), created)}
                className="w-full rounded-lg bg-[#f0eeeb] px-3 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50"
              >
                {atLimit ? `Limit of ${limit} reached` : `Connect to ${target.host}`}
              </button>
              <p className="text-[11px] leading-5 text-[#8f8b86]">
                Connecting only asks the server for its tool list. Nothing runs, and every tool stays off until you review it.
              </p>
            </div>
          )}

          {step === 'connect' && (
            <div className="space-y-3">
              <p role="status" className="flex items-center gap-2 text-sm text-[#d8d5d1]">
                {connecting && <Loader2 className={`h-4 w-4 text-[#aaa6a2] ${reduceMotion ? '' : 'animate-spin'}`} aria-hidden="true" />}
                {phase === 'creating' ? (created ? 'Saving the token…' : 'Adding the connection…')
                  : phase === 'testing' ? 'Connecting and asking for its tools…'
                  : phase === 'streaming' ? 'Tools arriving…'
                  : phase === 'ready' ? 'Connected. Nothing is switched on.'
                  : 'Not connecting.'}
              </p>

              {failure && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5">
                  <p role="alert" className="text-sm leading-5 text-red-200">{failure.guide.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {failure.guide.retry !== 'none' && (
                      <button
                        type="button"
                        onClick={retry}
                        className="rounded-md bg-[#f0eeeb] px-2.5 py-1 text-xs font-medium text-[#1c1b19] hover:bg-white"
                      >
                        {failure.guide.action}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => back('pick')}
                      className="rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.07]"
                    >
                      Back to the directory
                    </button>
                  </div>
                  {created && (
                    <p className="mt-2 text-[11px] leading-5 text-[#aaa6a2]">
                      {created.name} is already in your list, switched off, with this error under it. Retrying tests that same
                      connection rather than adding a second one.
                    </p>
                  )}
                </div>
              )}

              {phase !== 'idle' && (
                <ul aria-label="Discovered tools" className="space-y-1">
                  {tools.slice(0, shown).map((tool) => (
                    <motion.li
                      key={tool.id}
                      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', visualDuration: 0.26, bounce: 0 }}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 min-[400px]:gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="max-w-full min-w-0 truncate font-mono text-xs text-[#e5e2de]">{tool.name}</span>
                          {tool.access === 'read' ? (
                            <span className="flex items-center gap-1 text-[11px] text-[#9fd49f]"><ShieldCheck className="h-3 w-3" aria-hidden="true" /><HideOnNarrow>read</HideOnNarrow></span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] text-amber-200"><PenLine className="h-3 w-3" aria-hidden="true" /><HideOnNarrow>write</HideOnNarrow></span>
                          )}
                          <span className="text-[11px] tabular-nums text-[#8f8b86]">
                            {tool.estimatedTokens === null ? 'estimate pending' : `≈${formatMeterTokens(tool.estimatedTokens)} tokens (est.)`}
                          </span>
                          <span className="text-[11px] text-[#8f8b86]">off</span>
                        </div>
                        {tool.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-[#8f8b86]">{tool.description}</p>}
                      </div>
                    </motion.li>
                  ))}
                  {phase === 'streaming' && shown < tools.length && (
                    <li className="px-1 text-[11px] text-[#8f8b86]">{tools.length - shown} more arriving…</li>
                  )}
                  {phase !== 'streaming' && phase !== 'ready' && tools.length === 0 && (
                    <li className="px-1 text-[11px] text-[#8f8b86]">Asking the server for its tools…</li>
                  )}
                </ul>
              )}

              {phase === 'ready' && (
                <>
                  <p className="text-xs leading-5 text-[#aaa6a2]">
                    Every tool arrived off. Switch on what you want in the list: a tool is only offered to the model once you
                    have switched it on, and every call still waits for your approval in the chat.
                  </p>
                  <button
                    type="button"
                    onClick={() => (created ? onConnected(created) : onClose())}
                    className="w-full rounded-lg bg-[#f0eeeb] px-3 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white"
                  >
                    Show me the server
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}
