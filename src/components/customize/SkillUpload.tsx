'use client';
import React, { useRef, useState } from 'react';
import { AlertTriangle, Check, FileArchive, FileText, ShieldCheck, Upload, X } from 'lucide-react';
import { navigateTo, skillsPath } from '@/src/lib/navigation';
import { uploadSkills } from '@/src/lib/client/skills';
import type { SkillUploadResult } from '@/src/types/skill.types';
import { Breadcrumb } from './SkillsPage';

const ACCEPTED = /\.(md|zip|skill)$/i;
const MAX_FILES = 10;
const MAX_SIZE = 5 * 1024 * 1024;

/** Upload a skill: .md, .zip or .skill files, several at once. */
export default function SkillUpload() {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<SkillUploadResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const wrong = incoming.find((file) => !ACCEPTED.test(file.name));
    if (wrong) { setError(`${wrong.name} isn't a .md, .zip or .skill file.`); return; }
    const large = incoming.find((file) => file.size > MAX_SIZE || file.size === 0);
    if (large) { setError(`${large.name} must be between 1 byte and 5 MB.`); return; }
    const merged = [...files, ...incoming.filter((file) => !files.some((item) => item.name === file.name && item.size === file.size))];
    if (merged.length > MAX_FILES) { setError(`Upload up to ${MAX_FILES} files at once.`); return; }
    setError('');
    setResults(null);
    setFiles(merged);
  };

  const upload = async () => {
    if (!files.length || uploading) return;
    setUploading(true);
    setError('');
    try {
      const outcome = await uploadSkills(files);
      setResults(outcome);
      // Keep only the files that failed, so they can be fixed and retried.
      setFiles((current) => current.filter((file) => outcome.some((result) => result.fileName === file.name && result.error)));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <Breadcrumb current="Upload a skill" />
      <h2 className="mt-4 text-xl font-medium text-white">Upload a skill</h2>
      <p className="mt-1 text-sm text-[#aaa6a2]">Add a skill to your workspace. Checks run when you upload.</p>

      <h3 className="mt-6 text-sm font-medium text-[#d8d5d1]">Skill file</h3>
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); add(event.dataTransfer.files); }}
        className={`mt-2 flex flex-col items-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors ${dragging ? 'border-white/50 bg-white/[0.05]' : 'border-white/[0.18]'}`}
      >
        <Upload className="h-5 w-5 text-[#aaa6a2]" />
        <p className="mt-2 text-sm text-[#e5e2de]">
          Drag and drop skill files here, or{' '}
          <button type="button" onClick={() => inputRef.current?.click()} className="underline underline-offset-2 hover:text-white">browse</button>
          {' '}— you can add several at once
        </p>
        <ul className="mt-3 space-y-0.5 text-xs text-[#8f8b86]">
          <li>.md file must contain skill name and description formatted in YAML</li>
          <li>.zip or .skill file must include a SKILL.md file</li>
        </ul>
        <input ref={inputRef} type="file" multiple accept=".md,.zip,.skill" aria-label="Choose skill files" className="sr-only" onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
      </div>

      {files.length > 0 && (
        <ul aria-label="Files to upload" className="mt-3 space-y-1.5">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-[#e5e2de]">
              {/\.md$/i.test(file.name) ? <FileText className="h-4 w-4 text-[#aaa6a2]" /> : <FileArchive className="h-4 w-4 text-[#aaa6a2]" />}
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-[#8f8b86]">{(file.size / 1024).toFixed(1)} KB</span>
              <button type="button" onClick={() => setFiles((list) => list.filter((item) => item !== file))} aria-label={`Remove ${file.name}`} className="rounded p-1 text-[#aaa6a2] hover:bg-white/[0.08] hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#aaa6a2]" />
        <div className="text-xs leading-5 text-[#aaa6a2]">
          <p className="text-sm text-[#d8d5d1]">Checks</p>
          <p>Run when you upload: a valid SKILL.md, safe relative paths, size limits, and text files only. Images and other binaries are skipped. Scripts are stored but never run.</p>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

      {results && (
        <ul aria-label="Upload results" className="mt-4 space-y-2">
          {results.map((result) => (
            <li key={result.fileName} className={`rounded-xl border p-3 text-sm ${result.error ? 'border-red-400/30 bg-red-400/[0.05]' : 'border-white/[0.08]'}`}>
              <div className="flex items-center gap-2">
                {result.error ? <X className="h-4 w-4 text-red-300" /> : <Check className="h-4 w-4 text-[#9fd49f]" />}
                <span className="font-medium text-[#e5e2de]">{result.fileName}</span>
                {result.skill && <button type="button" onClick={() => navigateTo(skillsPath.skill(result.skill!.id))} className="ml-auto text-xs text-[#d9ceff] hover:underline">Open {result.skill.name}</button>}
              </div>
              {result.error && <p className="mt-1 pl-6 text-red-300">{result.error}</p>}
              {result.checks.map((check) => <p key={check} className="mt-1 pl-6 text-xs text-[#aaa6a2]">✓ {check}</p>)}
              {result.warnings.map((warning) => <p key={warning} className="mt-1 flex gap-1.5 pl-6 text-xs text-[#e8c879]"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{warning}</p>)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex items-center gap-2">
        <button type="button" onClick={() => void upload()} disabled={!files.length || uploading} className="rounded-lg bg-[#f0eeeb] px-4 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-40">
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <button type="button" onClick={() => navigateTo(skillsPath.yours)} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">{results?.some((result) => result.skill) ? 'Done' : 'Cancel'}</button>
        {!files.length && !results && <p className="text-xs text-[#8f8b86]">Choose a file to continue.</p>}
      </div>
    </div>
  );
}
