'use client';
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { buildMeterState, formatMeterTokens, meterValueText } from '@/src/lib/client/mcp-budget';
import type { McpConnectionView } from '@/src/types/mcp.types';

/** Segment colors cycle per server; amber stays reserved for the overflow. */
const SEGMENT_COLORS = ['bg-[#6ea8fe]', 'bg-[#9b8cff]', 'bg-[#5fc9a6]', 'bg-[#d4a5f2]', 'bg-[#7fc4e8]', 'bg-[#c9c6c2]'];

export interface ContextMeterProps {
  connections: readonly McpConnectionView[];
  budget?: number;
}

/**
 * The header context meter: one segment per connected server, sized by what
 * that server's enabled tools are estimated to cost the model. Overflow past
 * the budget turns amber and says so. Every number is an estimate.
 */
export default function ContextMeter({ connections, budget }: ContextMeterProps) {
  const state = buildMeterState(connections, budget);
  const scale = Math.max(state.total, state.budget, 1);
  const over = state.overBy > 0;

  return (
    <div className="px-4 pb-4 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-medium text-[#aaa6a2]">Tool-definition budget (estimated)</h3>
        <p className={`text-xs tabular-nums ${over ? 'text-amber-300' : 'text-[#d8d5d1]'}`}>
          <span aria-hidden="true">{formatMeterTokens(state.total)} of {formatMeterTokens(state.budget)} tokens (estimated)</span>
        </p>
      </div>
      <div
        role="meter"
        aria-label="Estimated tool-definition budget"
        aria-valuemin={0}
        aria-valuemax={state.budget}
        aria-valuenow={state.total}
        aria-valuetext={meterValueText(state)}
        className="mt-2 flex h-2 w-full gap-px overflow-hidden rounded-full bg-white/[0.06]"
      >
        {state.segments.map((segment, index) => (
          <span
            key={segment.id}
            aria-hidden="true"
            className={`h-full ${SEGMENT_COLORS[index % SEGMENT_COLORS.length]}`}
            style={{ width: `${(segment.estimatedTokens / scale) * 100}%` }}
          />
        ))}
        {over && (
          <span
            aria-hidden="true"
            className="h-full bg-amber-400/80"
            style={{ width: `${(state.overBy / scale) * 100}%` }}
          />
        )}
      </div>
      {state.segments.length > 0 && (
        <ul className="sr-only">
          {state.segments.map((segment) => (
            <li key={segment.id}>{segment.name}: about {formatMeterTokens(segment.estimatedTokens)} estimated tokens</li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {over ? (
          <p className="flex items-center gap-1 font-medium text-amber-300">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Over budget by {formatMeterTokens(state.overBy)} tokens (estimated)
          </p>
        ) : (
          <p className="text-[#8f8b86]">Only tools the model would receive are counted.</p>
        )}
        {state.unestimated > 0 && (
          <p className="text-[#aaa6a2]">
            {state.unestimated} {state.unestimated === 1 ? 'tool has' : 'tools have'} no estimate yet; re-test the connection.
          </p>
        )}
      </div>
    </div>
  );
}
