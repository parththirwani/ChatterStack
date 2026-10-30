import Image from 'next/image';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import { getModelMeta } from '@/src/lib/models';
import type { ModelHandoff } from './model-handoffs';

export default function ModelHandoffDivider({ from, to }: ModelHandoff) {
  const previous = getModelMeta(from);
  const next = getModelMeta(to);
  const previousName = previous?.name ?? from;
  const nextName = next?.name ?? to;

  return (
    <div
      className="model-handoff flex min-w-0 items-center gap-2 py-2 text-[11px] text-[#8f8b86]"
      aria-label={`Model changed from ${previousName} to ${nextName}`}
    >
      <span className="model-handoff-line h-px min-w-3 flex-1 bg-white/[0.08]" aria-hidden="true" />
      <ArrowRightLeft className="h-3 w-3 shrink-0" strokeWidth={1.6} aria-hidden="true" />
      <span className="shrink-0">Model changed</span>
      {previous && <Image src={previous.logo} alt="" width={13} height={13} className={`${previous.invert ? 'invert brightness-0' : ''} h-3.5 w-3.5 shrink-0 opacity-70`} />}
      <span className="min-w-0 max-w-[27vw] truncate" title={previousName}>{previousName}</span>
      <ArrowRight className="h-3 w-3 shrink-0" strokeWidth={1.6} aria-hidden="true" />
      {next && <Image src={next.logo} alt="" width={13} height={13} className={`${next.invert ? 'invert brightness-0' : ''} h-3.5 w-3.5 shrink-0`} />}
      <span className="min-w-0 max-w-[27vw] truncate text-[#c9a586]" title={nextName}>{nextName}</span>
      <span className="model-handoff-line h-px min-w-3 flex-1 bg-white/[0.08]" aria-hidden="true" />
    </div>
  );
}
