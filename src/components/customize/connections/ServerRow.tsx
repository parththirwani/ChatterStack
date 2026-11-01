'use client';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Link2, PenLine, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Switch } from '@/src/components/arc/switch/switch';
import { formatMeterTokens } from '@/src/lib/client/mcp-budget';
import { testMcpConnection } from '@/src/lib/client/mcp';
import type { McpConnectionView, McpToolView } from '@/src/types/mcp.types';
import HideOnNarrow from './HideOnNarrow';

export type RowStatusWord = 'Connected' | 'Needs sign-in' | 'Error' | 'Connecting' | 'Not tested';

export interface RowStatus {
  word: RowStatusWord;
  tone: 'good' | 'bad' | 'warn' | 'neutral';
}

/**
 * The row's real state, straight from stored fields. "Needs sign-in" is honest
 * in both directions it can come from: never having supplied a token, or a
 * stored error that names the token (the auth failures the MCP client service
 * records say "token"). Everything else that failed stays "Error".
 */
export function serverRowStatus(connection: McpConnectionView, connecting = false): RowStatus {
  if (connecting) return { word: 'Connecting', tone: 'neutral' };
  if (connection.status === 'connected') return { word: 'Connected', tone: 'good' };
  if (connection.status === 'error') {
    const authish = connection.authMode === 'bearer' && /token/i.test(connection.lastError ?? '');
    return { word: authish ? 'Needs sign-in' : 'Error', tone: 'bad' };
  }
  if (connection.authMode === 'bearer' && !connection.hasCredential) return { word: 'Needs sign-in', tone: 'warn' };
  return { word: 'Not tested', tone: 'neutral' };
}

const TONE_CLASSES: Record<RowStatus['tone'], string> = {
  good: 'bg-emerald-400/10 text-[#9fd49f]',
  bad: 'bg-red-400/10 text-red-300',
  warn: 'bg-amber-400/10 text-amber-200',
  neutral: 'bg-white/[0.06] text-[#aaa6a2]',
};

/** Enabled-tool count plus the estimated cost line the row shows and names itself with. */
export function serverRowCostText(connection: McpConnectionView): string {
  const enabled = connection.tools.filter((tool) => tool.enabled);
  if (enabled.length === 0) return connection.toolCount === 0 ? 'no tools discovered yet' : 'no tools on';
  const estimate = enabled.reduce((sum, tool) => sum + (tool.estimatedTokens ?? 0), 0);
  const pending = enabled.some((tool) => tool.estimatedTokens === null);
  const base = `about ${formatMeterTokens(estimate)} tokens (estimated)`;
  return pending ? `${estimate > 0 ? `${base}, plus unestimated tools` : 'estimates pending'}` : base;
}

/** Full accessible name: server, status, transport, tools on and cost. */
export function serverRowLabel(connection: McpConnectionView, status: RowStatus): string {
  const on = connection.tools.filter((tool) => tool.enabled).length;
  return `${connection.name}, ${status.word}, remote transport, ${on} of ${connection.toolCount} tools on, ${serverRowCostText(connection)}`;
}

export interface ServerRowProps {
  connection: McpConnectionView;
  expanded: boolean;
  /** The connection the add-server sheet just made: it slides in and stays lit for a moment. */
  entering?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onToggleConnection: () => void;
  onToggleTool: (tool: McpToolView) => void;
  onReviewTools: () => void;
  onRequestToken: () => void;
  onRequestRemove: () => void;
  announce: (message: string) => void;
}

/** One server inside the management block: header, status, expandable tool review. */
export default function ServerRow({
  connection,
  expanded,
  entering = false,
  onExpandedChange,
  onToggleConnection,
  onToggleTool,
  onReviewTools,
  onRequestToken,
  onRequestRemove,
  announce,
}: ServerRowProps) {
  const reduceMotion = useReducedMotion();
  const [connecting, setConnecting] = useState(false);
  const [testError, setTestError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const status = serverRowStatus(connection, connecting);
  const panelId = `mcp-server-panel-${connection.id}`;
  const onCount = connection.tools.filter((tool) => tool.enabled).length;
  const awaitingReview = connection.needsReview && connection.toolCount > 0;

  // The Review button disappears the moment the review is recorded. If keyboard
  // focus was on it, the browser drops focus to the body, so hand it back to the
  // row rather than leaving the keyboard user at the top of the document.
  const wasAwaitingReview = useRef(awaitingReview);
  useEffect(() => {
    const was = wasAwaitingReview.current;
    wasAwaitingReview.current = awaitingReview;
    if (was && !awaitingReview && document.activeElement === document.body) triggerRef.current?.focus();
  }, [awaitingReview]);

  const runTest = async () => {
    setConnecting(true);
    setTestError('');
    try {
      const result = await testMcpConnection(connection.id);
      if (!result.ok) setTestError(result.error ?? 'The server did not answer.');
      else {
        const found = result.connection.toolCount;
        announce(`${connection.name} connected with ${found} ${found === 1 ? 'tool' : 'tools'}. Review and switch tools on to use them.`);
        onExpandedChange(true);
      }
    } catch (failure) {
      setTestError((failure as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <motion.li
      data-row-id={connection.id}
      data-entering={entering ? 'true' : undefined}
      initial={entering && !reduceMotion ? { opacity: 0, x: -12 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', visualDuration: 0.32, bounce: 0 }}
      className={`border-b border-white/[0.06] last:border-b-0 ${reduceMotion ? '' : 'transition-colors duration-500'} ${entering ? 'bg-white/[0.06]' : ''}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          ref={triggerRef}
          data-mcp-row-trigger
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={serverRowLabel(connection, status)}
          onClick={() => onExpandedChange(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 min-[400px]:gap-3"
        >
          <ChevronRight className={`h-4 w-4 shrink-0 text-[#8f8b86] ${reduceMotion ? '' : 'transition-transform duration-150'} ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-[#eee]">{connection.name}</span>
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CLASSES[status.tone]}`}>{status.word}</span>
              {!connection.enabled && <span className="shrink-0 text-[11px] text-[#8f8b86]">Off</span>}
            </span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-[#8f8b86]">
              <span className="shrink-0 rounded-md bg-white/[0.05] px-1.5 py-px text-[10px] uppercase tracking-wide text-[#aaa6a2]">Remote</span>
              <span className="shrink-0">{onCount} of {connection.toolCount} {connection.toolCount === 1 ? 'tool' : 'tools'} on</span>
              <span aria-hidden="true" className="shrink-0 sr-only min-[400px]:not-sr-only">·</span>
              <HideOnNarrow>{serverRowCostText(connection)}</HideOnNarrow>
            </span>
          </span>
        </button>
        <Switch checked={connection.enabled} onCheckedChange={onToggleConnection} aria-label={`Enable ${connection.name}`} />
      </div>

      {connection.status === 'error' && connection.lastError && (
        <p className="px-3 pb-2 pl-3 text-xs leading-5 text-red-300 min-[400px]:pl-12">{connection.lastError}</p>
      )}
      {testError && <p role="alert" className="px-3 pb-2 pl-3 text-xs leading-5 text-red-300 min-[400px]:pl-12">{testError}</p>}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="panel"
            id={panelId}
            role="region"
            aria-label={`${connection.name} details`}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', visualDuration: 0.32, bounce: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pl-3 min-[400px]:pl-12">
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-[#8f8b86]">
                <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">Endpoint</span>
                <span className="break-all font-mono text-[#aaa6a2]">{connection.url}</span>
                <span className="shrink-0">· {connection.hasCredential ? 'Token stored' : 'No token'}</span>
              </p>

              {awaitingReview && (
                <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300/20 bg-amber-400/[0.06] px-3 py-2">
                  <p className="min-w-0 flex-1 text-xs text-[#e6d9b8]">The tool list changed since you last reviewed it. Look it over before turning this connection on.</p>
                  <button
                    type="button"
                    onClick={onReviewTools}
                    aria-label={`Review tools for ${connection.name}`}
                    className="rounded-md bg-[#f0eeeb] px-2.5 py-1 text-xs font-medium text-[#1c1b19] hover:bg-white"
                  >
                    Review tools
                  </button>
                </div>
              )}

              {connection.toolCount > 0 ? (
                <ul aria-label={`Tools on ${connection.name}`} className="mt-2 space-y-1">
                  {connection.tools.map((tool) => (
                    <li key={tool.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.025] min-[400px]:gap-3">
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
                        </div>
                        {tool.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-[#8f8b86]">{tool.description}</p>}
                      </div>
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={() => onToggleTool(tool)}
                        aria-label={`Enable ${tool.name} on ${connection.name}`}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[#8f8b86]">No tools discovered yet. Test the connection to see what it offers.</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={connecting}
                  aria-label={`Test ${connection.name}`}
                  className="rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.07] disabled:opacity-50"
                >
                  {connecting ? 'Connecting…' : connection.status === 'error' ? 'Try again' : connection.status === 'connected' ? 'Re-test' : 'Test'}
                </button>
                <button
                  type="button"
                  onClick={onRequestToken}
                  aria-label={`${connection.hasCredential ? 'Change' : 'Add'} token for ${connection.name}`}
                  className="rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.07]"
                >
                  Token
                </button>
                <button
                  type="button"
                  onClick={onRequestRemove}
                  aria-label={`Remove ${connection.name}`}
                  className="rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-red-300 hover:bg-red-400/10"
                >
                  Remove
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
