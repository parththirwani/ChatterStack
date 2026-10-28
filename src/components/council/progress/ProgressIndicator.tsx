"use client";
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { Check } from 'lucide-react';
import { getModelMeta } from '@/src/lib/models';
import { Orb } from '@/src/components/ui/orb/Orb';
import type { CouncilDetails, CouncilProgress } from '@/src/types/chat.types';

interface CouncilProgressIndicatorProps {
  progress: CouncilProgress[];
  details: CouncilDetails;
}

const STEPS = [
  { stage: 'stage1', name: 'Independent answers' },
  { stage: 'stage2', name: 'Peer review' },
  { stage: 'stage3', name: 'Final answer' },
] as const;

type MemberStatus = 'queued' | 'working' | 'done' | 'skipped';

function memberStatus(progress: CouncilProgress[], stage: string, model: string): MemberStatus {
  const entry = progress.find((p) => p.stage === stage && p.model === model);
  if (!entry) return 'queued';
  if (entry.progress < 0) return 'skipped';
  return entry.progress >= 100 ? 'done' : 'working';
}

// Isolated so the once-a-second tick only re-renders the clock text, not the
// step list around it.
const Clock: React.FC = () => {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - startedAt) / 1000);
  return <span className="tabular-nums">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>;
};

const ModelName: React.FC<{ id: string }> = ({ id }) => {
  const model = getModelMeta(id);
  return (
    <>
      {model && <Image src={model.logo} alt="" width={14} height={14} className={`h-3.5 w-3.5 shrink-0 ${model.invert ? 'invert brightness-0' : ''}`} />}
      <span className="min-w-0 flex-1 truncate">{model?.name ?? id}</span>
    </>
  );
};

const StatusMark: React.FC<{ status: MemberStatus }> = ({ status }) => {
  if (status === 'done') return <><Check className="h-3.5 w-3.5 shrink-0 text-[#e6e3de]" strokeWidth={2.2} aria-hidden="true" /><span className="sr-only">Done</span></>;
  if (status === 'working') return <><Orb state="searching" /><span className="sr-only">Working</span></>;
  return <span className="shrink-0 text-[#a9a5a0]">{status === 'skipped' ? 'Skipped' : 'Queued'}</span>;
};

const StepMarker: React.FC<{ state: 'done' | 'active' | 'pending'; stage: string }> = ({ state, stage }) => {
  if (state === 'active') return <Orb state={stage === 'stage1' ? 'searching' : 'composing'} />;
  if (state === 'done') {
    return <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[#f0eeeb]"><Check className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" /></span>;
  }
  return <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-white/20" aria-hidden="true" />;
};

const CouncilProgressIndicator: React.FC<CouncilProgressIndicatorProps> = ({ progress, details }) => {
  const currentIndex = Math.max(0, ...STEPS.map((step, index) => (progress.some((p) => p.stage === step.stage) ? index : 0)));
  const current = STEPS[currentIndex];
  const chairName = getModelMeta(details.chair)?.name ?? details.chair;

  const answered = details.members.filter((id) => memberStatus(progress, 'stage1', id) === 'done');
  const skipped = details.members.filter((id) => memberStatus(progress, 'stage1', id) === 'skipped');
  const reviewers = answered.filter((id) => memberStatus(progress, 'stage2', id) === 'done');

  const participants = (stage: string) => (stage === 'stage1' ? details.members : answered);

  const summary = (stage: string): string => {
    if (stage === 'stage1') {
      return `${answered.length} of ${details.members.length} members answered${skipped.length ? ` · ${skipped.length} skipped` : ''}`;
    }
    if (stage === 'stage2') return `Rankings from ${reviewers.length} of ${answered.length} members`;
    return `Chair · ${chairName}`;
  };

  return (
    <div className="not-prose mb-4 rounded-xl border border-white/10 bg-[#222222] p-4">
      <div className="mb-3 flex items-center gap-3">
        <Orb size={32} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#f0eeeb]">Council is deliberating</h3>
          <p className="text-[12px] text-[#a9a5a0]">
            Step {currentIndex + 1} of {STEPS.length} · {current.name} · <Clock />
          </p>
        </div>
        <span className="sr-only" aria-live="polite">Step {currentIndex + 1} of {STEPS.length}: {current.name}</span>
      </div>

      <ol className="space-y-1">
        {STEPS.map((step, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
          return (
            <li key={step.stage} className="flex items-start gap-2.5 py-1.5 text-[13px]">
              <StepMarker state={state} stage={step.stage} />
              <div className="min-w-0 flex-1">
                <div className={state === 'pending' ? 'text-[#a9a5a0]' : 'text-[#f0eeeb]'}>{step.name}</div>
                {(state === 'done' || step.stage === 'stage3') && (
                  <div className="text-[12px] text-[#a9a5a0]">{summary(step.stage)}</div>
                )}
                {state === 'active' && step.stage !== 'stage3' && (
                  <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {participants(step.stage).map((id) => (
                      <li key={id} className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2.5 text-[12px] text-[#e6e3de]">
                        <ModelName id={id} />
                        <StatusMark status={memberStatus(progress, step.stage, id)} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default CouncilProgressIndicator;
