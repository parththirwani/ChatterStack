'use client';
import React from 'react';
import { CircleCheck, CircleX, Clock, Hourglass, Loader2, ShieldQuestion } from 'lucide-react';
import type { LiveToolCallView, MessageToolCallView, ToolCallState } from '@/src/types/chat.types';

const statusLabel: Record<ToolCallState, string> = {
  completed: 'Completed',
  failed: 'Failed',
  denied: 'Denied',
  not_approved: 'Not approved',
  invalid_arguments: 'Bad arguments',
  not_enabled: 'Not enabled',
  too_large: 'Too large',
  repeated: 'Already called',
  cancelled: 'Stopped',
  timed_out: 'Expired',
};

const statusClass = (status: ToolCallState) =>
  status === 'completed'
    ? 'bg-emerald-400/10 text-[#9fd49f]'
    : status === 'denied' || status === 'not_approved' || status === 'cancelled' || status === 'timed_out'
      ? 'bg-amber-400/10 text-[#e6d9b8]'
      : 'bg-red-400/10 text-red-300';

const StatusIcon = ({ status }: { status: ToolCallState }) =>
  status === 'completed'
    ? <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
    : status === 'denied' || status === 'not_approved' || status === 'cancelled' || status === 'timed_out'
      ? <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      : <CircleX className="h-3.5 w-3.5" aria-hidden="true" />;

function CallRow({ call }: { call: MessageToolCallView }) {
  const detail = call.error || call.result;
  return (
    <li aria-label={`Tool call ${call.name}: ${statusLabel[call.status]}`} className="flex items-start gap-2 py-1.5">
      <span className="mt-0.5 shrink-0"><StatusIcon status={call.status} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-[#e5e2de]">{call.name}</span>
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${statusClass(call.status)}`}>{statusLabel[call.status]}</span>
          {call.truncated && <span className="text-[11px] text-[#8f8b86]">result shortened</span>}
        </div>
        {detail && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-[#8f8b86] hover:text-[#d8d5d1]">
              {call.status === 'completed' ? 'Result sent to the model' : 'What the model was told'}
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11px] leading-4 text-[#c9c6c2]">{detail}</pre>
          </details>
        )}
      </div>
    </li>
  );
}

/** The call the user is looking at right now: waiting, deciding or running. */
function LiveCallRow({ call, onDecision }: { call: LiveToolCallView; onDecision?: (decision: 'approved' | 'denied') => void }) {
  const busy = call.state === 'deciding';
  const argumentsText = call.arguments ? JSON.stringify(call.arguments, null, 2) : '';
  return (
    <li aria-label={`Tool call ${call.name}: ${call.state}`} className="border-t border-white/[0.06] py-2">
      <div className="flex items-center gap-2">
        {call.state === 'running'
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#aaa6a2]" aria-hidden="true" />
          : <ShieldQuestion className="h-3.5 w-3.5 shrink-0 text-[#e6d9b8]" aria-hidden="true" />}
        <span className="font-mono text-xs text-[#e5e2de]">{call.name}</span>
        {call.state === 'pending' && <span className="rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-[#e6d9b8]">Needs your approval</span>}
        {call.state === 'deciding' && <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11px] text-[#aaa6a2]">Sending your decision…</span>}
        {call.state === 'running' && <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11px] text-[#aaa6a2]">Running…</span>}
        {call.state === 'lost' && <span role="alert" className="rounded-md bg-red-400/10 px-1.5 py-0.5 text-[11px] text-red-300">{call.error ?? 'That approval is no longer open.'}</span>}
      </div>
      {call.state === 'pending' && (
        <>
          <p className="mt-1 text-[11px] text-[#8f8b86]">
            An external server runs this only if you approve it. It gets the exact arguments below.
          </p>
          {argumentsText && (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11px] leading-4 text-[#c9c6c2]">{argumentsText}</pre>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDecision?.('approved')}
              disabled={busy}
              aria-label={`Approve ${call.name}`}
              className="rounded-lg bg-[#f0eeeb] px-3 py-1.5 text-xs font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onDecision?.('denied')}
              disabled={busy}
              aria-label={`Deny ${call.name}`}
              className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-xs text-[#e5e2de] hover:bg-white/[0.06] disabled:opacity-50"
            >
              Deny
            </button>
            <span className="flex items-center gap-1 text-[11px] text-[#8f8b86]">
              <Hourglass className="h-3 w-3" aria-hidden="true" />
              expires on its own if you do nothing
            </span>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * What the tool loop did on this turn: the recorded calls, the one that needs
 * a decision now, and any note about tools that never ran.
 */
export default function ToolCallCard({
  calls,
  live,
  notices,
  onDecision,
}: {
  calls?: MessageToolCallView[];
  live?: LiveToolCallView;
  notices?: string[];
  onDecision?: (decision: 'approved' | 'denied') => void;
}) {
  if (!calls?.length && !live && !notices?.length) return null;
  return (
    <section
      aria-label="Tool calls"
      className="mb-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-1.5"
    >
      {notices?.length ? (
        <ul aria-label="Tool notices" className="space-y-1 py-1">
          {notices.map((notice, index) => (
            <li key={index} className="text-[11px] text-[#e6d9b8]">{notice}</li>
          ))}
        </ul>
      ) : null}
      {calls?.length ? (
        <ul aria-label="Recorded tool calls" className="divide-y divide-white/[0.06]">
          {calls.map((call) => <CallRow key={call.callId} call={call} />)}
        </ul>
      ) : null}
      {live && <LiveCallRow call={live} onDecision={onDecision} />}
    </section>
  );
}
