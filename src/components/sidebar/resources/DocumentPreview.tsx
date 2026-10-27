'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, X } from 'lucide-react';

interface PreviewDocument {
  id: string;
  name: string;
  mimeType: string;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * `localFile` is the picked file when it was just uploaded from this browser.
 * Its bytes are the saved bytes, so the preview opens without downloading
 * them again. DOCX still goes through the server, which extracts its text.
 */
export default function DocumentPreview({ document: file, localFile, onClose }: { document: PreviewDocument; localFile?: Blob; onClose: () => void }) {
  const [content, setContent] = useState<{ kind: 'loading' | 'text' | 'file' | 'error'; value: string }>({ kind: 'loading', value: '' });
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const url = `/api/documents/${file.id}/content`;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const openFromServer = async () => {
      const response = await fetch(`${url}?preview=1`, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not open this file.');
      return response;
    };
    const load = async () => {
      setContent({ kind: 'loading', value: '' });
      try {
        const local = file.mimeType === DOCX ? undefined : localFile;
        const isText = file.mimeType.startsWith('text/') || file.mimeType === DOCX;
        if (isText) {
          const value = local ? await local.text() : await (await openFromServer()).text();
          if (!controller.signal.aborted) setContent({ kind: 'text', value });
        } else {
          const blob = local ? local.slice(0, local.size, file.mimeType) : await (await openFromServer()).blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setContent({ kind: 'file', value: objectUrl });
        }
      } catch {
        if (!controller.signal.aborted) setContent({ kind: 'error', value: 'Could not open this file.' });
      }
    };
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.mimeType, localFile, url]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="document-preview-title" className="flex h-[min(90vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#202020] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <FileText className="h-5 w-5 shrink-0 text-[#aaa6a2]" aria-hidden="true" />
          <h2 id="document-preview-title" className="min-w-0 flex-1 truncate text-sm font-medium text-white" title={file.name}>{file.name}</h2>
          <a href={url} aria-label={`Download ${file.name}`} className="rounded-lg p-2 text-[#c9c6c2] hover:bg-white/10 hover:text-white"><Download className="h-4 w-4" /></a>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close preview" className="rounded-lg p-2 text-[#c9c6c2] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {content.kind === 'loading' && <p className="text-sm text-[#aaa6a2]">Loading preview…</p>}
          {content.kind === 'error' && <p role="alert" className="text-sm text-red-300">{content.value}</p>}
          {content.kind === 'text' && <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-[#eee]">{content.value || 'This document is empty.'}</pre>}
          {content.kind === 'file' && file.mimeType.startsWith('image/') && <div className="flex h-full items-center justify-center">{/* Blob URLs are already local and do not need image optimization. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={content.value} alt={file.name} className="max-h-full max-w-full object-contain" />
          </div>}
          {content.kind === 'file' && file.mimeType === 'application/pdf' && <iframe src={content.value} title={`Preview of ${file.name}`} className="h-full min-h-[500px] w-full rounded bg-white" />}
        </div>
      </section>
    </div>,
    document.body,
  );
}
