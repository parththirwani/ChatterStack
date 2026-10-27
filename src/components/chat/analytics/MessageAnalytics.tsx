"use client";
import React, { useId, useState } from 'react';
import Image from 'next/image';
import { ChevronDown } from 'lucide-react';
import { getModelMeta } from '@/src/lib/models';
import type { CompletionAnalytics, ModelTiming } from '@/src/types/chat.types';

const STAGE_NAMES: Record<string, string> = {
  stage1: 'Answer',
  stage2: 'Review',
  stage3: 'Final answer',
};

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 1) return Math.round(ms) + 'ms';
  if (seconds < 60) return seconds.toFixed(1) + 's';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

/** Timings arrive per model call; the panel shows one row per model. */
function groupByModel(timings: ModelTiming[]) {
  const groups = new Map<string, { total: number; calls: ModelTiming[] }>();
  for (const timing of timings) {
    const group = groups.get(timing.model) ?? { total: 0, calls: [] };
    group.total += timing.durationMs;
    group.calls.push(timing);
    groups.set(timing.model, group);
  }
  return [...groups.entries()]
    .map(([model, group]) => ({ model, ...group }))
    .sort((a, b) => b.total - a.total);
}

interface MessageAnalyticsProps {
  analytics: CompletionAnalytics;
}

/**
 * What the completion cost: tokens and wall-clock time. Hovering (or focusing)
 * opens the detail, which in council mode breaks the total down per model.
 */
const MessageAnalytics: React.FC<MessageAnalyticsProps> = ({ analytics }) => {
  const panelId = useId();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const models = analytics.timings ? groupByModel(analytics.timings) : [];

  return (
    <span className="relative inline-flex" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setPinned((value) => !value)}
        className="flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-[#a9a5a0] transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="tabular-nums">{formatTokens(analytics.totalTokens) + ' tokens · ' + formatDuration(analytics.durationMs)}</span>
        <ChevronDown className={'h-3 w-3 shrink-0 transition-transform' + (open ? ' rotate-180' : '')} strokeWidth={1.8} aria-hidden="true" />
      </button>

      <span
        id={panelId}
        hidden={!open}
        className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-white/10 bg-[#232323] p-2.5 text-left shadow-xl"
      >
        <span className="block text-[12px] text-[#e6e3de]">
          {analytics.inputTokens.toLocaleString() + ' sent · ' + analytics.outputTokens.toLocaleString() + ' returned'}
        </span>
        {models.length > 0 && (
          <span className="mt-1.5 block border-t border-white/10 pt-1.5">
            {models.map((group) => {
              const model = getModelMeta(group.model);
              return (
                <span key={group.model} className="flex items-center gap-2 py-0.5 text-[12px] text-[#a9a5a0]">
                  {model && <Image src={model.logo} alt="" width={12} height={12} className={`h-3 w-3 shrink-0 ${model.invert ? 'invert brightness-0' : ''}`} />}
                  <span className="min-w-0 flex-1 truncate text-[#e6e3de]">{model?.name ?? group.model}</span>
                  <span className="shrink-0 tabular-nums">{group.calls.map((call) => (STAGE_NAMES[call.stage] ?? call.stage) + ' ' + formatDuration(call.durationMs)).join(' · ')}</span>
                </span>
              );
            })}
          </span>
        )}
      </span>
    </span>
  );
};

export default MessageAnalytics;
