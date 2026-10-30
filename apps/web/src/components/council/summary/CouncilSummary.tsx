"use client";
import React, { useId, useState } from 'react';
import Image from 'next/image';
import { ChevronRight, UsersRound } from 'lucide-react';
import { getModelMeta } from '@/src/lib/models';
import MarkdownContent from '@/src/components/chat/messages/AIMessage/MarkdownContent';
import type { CouncilAnswer, CouncilDetails } from '@/src/types/chat.types';

const MemberAnswer: React.FC<{ answer: CouncilAnswer; rank?: number; averageRank?: number }> = ({ answer, rank, averageRank }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const model = getModelMeta(answer.model);

  return (
    <li className="rounded-lg border border-white/[0.08] bg-white/[0.025]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] text-[#e6e3de] transition-colors hover:bg-white/[0.04]"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[#a9a5a0] transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={1.7} aria-hidden="true" />
        {model && <Image src={model.logo} alt="" width={14} height={14} className={`h-3.5 w-3.5 shrink-0 ${model.invert ? 'invert brightness-0' : ''}`} />}
        <span className="min-w-0 flex-1 truncate font-medium">{model?.name ?? answer.model}</span>
        {rank !== undefined && (
          <span className="shrink-0 text-[12px] text-[#a9a5a0]">
            Rank {rank}
            {averageRank !== undefined && <span className="tabular-nums"> · avg {averageRank.toFixed(1)}</span>}
          </span>
        )}
      </button>
      <div id={panelId} hidden={!open} className="max-h-96 overflow-y-auto border-t border-white/[0.08] px-4 py-3">
        <div className="prose prose-invert prose-sm max-w-none">
          <MarkdownContent content={answer.response} />
        </div>
      </div>
    </li>
  );
};

export const CouncilSummary: React.FC<{ details: CouncilDetails }> = ({ details }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (details.answers.length === 0) return null;

  const rankOf = (id: string) => {
    const index = details.rankings.findIndex((r) => r.model === id);
    return index === -1 ? undefined : { rank: index + 1, averageRank: details.rankings[index].averageRank };
  };
  const ordered = [...details.answers].sort((a, b) => (rankOf(a.model)?.rank ?? 99) - (rankOf(b.model)?.rank ?? 99));
  const leader = details.rankings[0] && getModelMeta(details.rankings[0].model)?.name;
  const headline = `Council of ${details.answers.length}${leader ? ` · ranked ${leader} first` : ''}`;

  return (
    <div className="not-prose mb-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="-ml-1.5 flex min-h-8 max-w-full items-center gap-2 rounded-lg px-1.5 text-left text-[13px] text-[#a9a5a0] transition-colors hover:bg-white/[0.05] hover:text-[#e6e3de]"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center"><UsersRound className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /></span>
        <span className="truncate">{headline}</span>
        <span className="shrink-0 text-[#cfcbc5]">· {open ? 'Hide individual answers' : 'View individual answers'}</span>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <ul id={panelId} hidden={!open} className="mt-2 space-y-1.5">
        {ordered.map((answer) => (
          <MemberAnswer key={answer.model} answer={answer} {...rankOf(answer.model)} />
        ))}
      </ul>
    </div>
  );
};
