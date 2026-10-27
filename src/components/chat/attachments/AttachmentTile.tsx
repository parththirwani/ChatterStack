'use client';

import React from 'react';
import { AlertCircle, FileText, Loader2, X } from 'lucide-react';

const FILE_LABELS: Record<string, string> = { pdf: 'PDF', docx: 'DOCX', txt: 'TXT', md: 'MD' };

export interface AttachmentTileProps {
  name: string;
  mimeType: string;
  /** Local object URL shown right after a file is picked, before it finishes uploading. */
  previewUrl?: string;
  /** Server content URL for a saved document. */
  sourceUrl?: string;
  /** 0..1 while uploading. */
  progress?: number;
  uploading?: boolean;
  /** Upload error shown over the tile until it is dismissed. */
  error?: string | null;
  /** The document was deleted after the message was sent. */
  removed?: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
}

/**
 * The composer and sent messages share one tile so an attachment looks the
 * same while it uploads and after it is sent. Images preview immediately from
 * a local object URL; other types show a labelled card until a preview exists.
 */
export default function AttachmentTile({
  name, mimeType, previewUrl, sourceUrl, progress = 0, uploading = false, error, removed = false, onOpen, onRemove,
}: AttachmentTileProps) {
  const isImage = mimeType.startsWith('image/');
  const source = previewUrl ?? sourceUrl;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const label = FILE_LABELS[extension] ?? (extension ? extension.toUpperCase() : 'FILE');
  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  const state = uploading ? `uploading ${percent}%` : error ? 'upload failed' : removed ? 'removed' : 'attached';

  return (
    <div
      title={`${name} — ${state}`}
      aria-label={`${name}, ${state}`}
      role="listitem"
      className={`group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border bg-white/[0.05] ${error ? 'border-red-400/70' : 'border-white/[0.14]'} ${removed ? 'opacity-60' : ''}`}
    >
      {isImage && source
        ? // Blob and private document URLs do not go through image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt={name}
            decoding="async"
            loading="lazy"
            className={`h-full w-full object-cover transition-[filter,opacity] duration-200 ${uploading ? 'opacity-70 blur-[1px]' : 'opacity-100'} ${removed ? 'grayscale' : ''}`}
          />
        : <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 text-center">
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${label === 'PDF' ? 'bg-[#e5484d] text-white' : 'bg-white/15 text-[#e6e3df]'}`}>{label}</span>
          <FileText className="h-4 w-4 text-white/45" aria-hidden="true" />
          <span className="line-clamp-2 w-full break-all text-[9px] leading-[1.2] text-white/60">{name}</span>
        </div>}

      {uploading && <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1 ${isImage ? 'bg-black/35' : 'bg-black/60'}`}>
        {!isImage && <span className="absolute inset-0 animate-pulse bg-white/[0.07]" aria-hidden="true" />}
        <Loader2 className="relative h-5 w-5 animate-spin text-white/90" aria-hidden="true" />
        <span className="relative text-[10px] font-medium tabular-nums text-white/90">{percent}%</span>
        <span className="absolute inset-x-1.5 bottom-1.5 h-[3px] overflow-hidden rounded-full bg-white/25" aria-hidden="true">
          <span className="block h-full rounded-full bg-white/90 transition-[width] duration-300 ease-out" style={{ width: `${Math.max(percent, 4)}%` }} />
        </span>
      </div>}

      {error && !uploading && <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/65 px-1 text-center">
        <AlertCircle className="h-4 w-4 text-red-300" aria-hidden="true" />
        <span className="text-[9px] leading-tight text-red-200">Upload failed</span>
      </div>}

      {removed && !uploading && <div className="absolute inset-0 flex items-end justify-center pb-2">
        <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/80">Removed</span>
      </div>}

      {/* The overlay keeps the whole tile clickable without nesting buttons. */}
      {onOpen && !removed && !uploading && !error && <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${name}`}
        className="absolute inset-0 z-10 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
      />}

      {onRemove && <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="absolute right-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white/85 transition-opacity hover:bg-black/85 hover:text-white focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>}
    </div>
  );
}
