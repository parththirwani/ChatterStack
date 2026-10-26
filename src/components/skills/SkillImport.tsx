'use client';

import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileUp, X } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { MAX_SKILL_FILE_SIZE } from '@/src/lib/skills/skill-file';
import { importSkillFile, type SkillDraftResult } from '@/src/lib/client/skills';

interface SkillImportProps {
  onClose: () => void;
  /** Called with the parsed draft; the caller opens it in the editor. */
  onImported: (result: SkillDraftResult) => void;
}

/** Imports a SKILL.md from a file or pasted text. Nothing is saved here. */
export default function SkillImport({ onClose, onImported }: SkillImportProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  useModalFocus(true, onClose, dialogRef);

  const parse = async (content: string, fileName?: string) => {
    setBusy(true);
    setError('');
    try {
      onImported(await importSkillFile(content, fileName));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { setError('Choose a SKILL.md or other Markdown file.'); return; }
    if (file.size > MAX_SKILL_FILE_SIZE) { setError('The file is larger than 64 KB.'); return; }
    await parse(await file.text(), file.name);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#202020] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <h2 id={`${ids}-title`} className="flex-1 text-sm font-medium text-white">Import a skill</h2>
          <button type="button" onClick={onClose} aria-label="Close import" className="rounded-lg p-2 text-[#c9c6c2] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-5 text-[#aaa6a2]">
            Import a <code className="text-[#d8d5d1]">SKILL.md</code> in the Agent Skills format (YAML frontmatter with <code className="text-[#d8d5d1]">name</code> and <code className="text-[#d8d5d1]">description</code>, then instructions). You can review it before saving. Only the file&apos;s text is imported. Scripts and other files in a skill folder are not.
          </p>
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" aria-label="Choose a skill file" className="sr-only" onChange={(event) => void chooseFile(event.target.files)} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-5 text-sm text-[#d8d5d1] hover:border-white/35 hover:bg-white/[0.03] disabled:opacity-50">
            <FileUp className="h-4 w-4" /> Choose SKILL.md
          </button>
          <div className="flex items-center gap-3 text-[11px] text-[#77736f]"><div className="h-px flex-1 bg-white/10" />or paste it<div className="h-px flex-1 bg-white/10" /></div>
          <label htmlFor={`${ids}-paste`} className="sr-only">Skill file text</label>
          <textarea
            id={`${ids}-paste`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder={'---\nname: my-skill\ndescription: What it does and when to use it\n---\n\nInstructions…'}
            className="w-full resize-y rounded-lg border border-white/[0.12] bg-[#181818] px-3 py-2 font-mono text-[13px] leading-5 text-[#eee] placeholder:text-[#77736f] focus:border-white/30 focus:outline-none"
          />
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">Cancel</button>
          <button type="button" onClick={() => void parse(text)} disabled={!text.trim() || busy} className="rounded-lg bg-[#f0eeeb] px-4 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50">
            {busy ? 'Reading…' : 'Continue'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
