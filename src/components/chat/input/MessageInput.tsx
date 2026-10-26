"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Sparkles, Square, X } from 'lucide-react';
import { ModelSelector } from './ModelSelector/ModelSelector';
import { ThinkingSelector } from './ModelSelector/ThinkingSelector';
import { CouncilToggle } from './CouncilToggle';
import LLMTokenIndicator from '../../rate-limit/LLMTokenIndicator';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import type { DocumentAttachment } from '@/src/types/chat.types';
import { MIME_BY_EXTENSION, uploadDocument } from '@/src/lib/client/documents';
import { useAppStore } from '@/src/store/rootStore';
import type { SkillTag } from '@/src/types/skill.types';
import { useSkills } from '@/src/lib/client/skills';
import { MAX_SKILLS_PER_MESSAGE } from '@/src/lib/skills/skill-file';
import { matchSkills, removeSlashQuery, slashQueryAt, type SlashQuery } from '@/src/lib/skills/slash';

interface MessageInputProps {
  message: string;
  onMessageChange: (message: string) => void;
  attachments: DocumentAttachment[];
  onAttachmentsChange: React.Dispatch<React.SetStateAction<DocumentAttachment[]>>;
  skills?: SkillTag[];
  onSkillsChange?: React.Dispatch<React.SetStateAction<SkillTag[]>>;
  onSendMessage: () => void;
  loading: boolean;
  onStopGenerating?: () => void;
  placeholder?: string;
}

const NO_SKILLS: SkillTag[] = [];

const MessageInput: React.FC<MessageInputProps> = ({ message, onMessageChange, attachments, onAttachmentsChange, skills: tagged = NO_SKILLS, onSkillsChange, onSendMessage, loading, onStopGenerating, placeholder = 'Ask anything' }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const [readingFiles, setReadingFiles] = useState(false);
  const { councilMode } = useModelSelection();
  const userId = useAppStore((state) => state.user?.id);
  const signedIn = !!userId && userId !== 'guest';
  const canTagSkills = signedIn && !!onSkillsChange;
  const { skills: allSkills, loading: skillsLoading } = useSkills(canTagSkills ? userId : null);
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  // The `/` the user dismissed with Escape; the picker stays closed for it.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const pickerId = useId();

  const pickerOpen = canTagSkills && !!slash && dismissedAt !== slash.start;
  const options = useMemo(
    () => (pickerOpen ? matchSkills(allSkills.filter((skill) => !tagged.some((tag) => tag.id === skill.id)), slash.query) : []),
    [pickerOpen, allSkills, tagged, slash]
  );
  const active = Math.min(activeOption, Math.max(options.length - 1, 0));

  const updateSlash = (text: string, caret: number | null) => {
    const next = caret === null ? null : slashQueryAt(text, caret);
    setSlash((current) => (current?.start === next?.start && current?.end === next?.end && current?.query === next?.query ? current : next));
    if (next?.start !== slash?.start) setActiveOption(0);
    if (!next || next.start !== dismissedAt) setDismissedAt(null);
  };

  const placeCaret = (position: number) => {
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(position, position);
    });
  };

  const tagSkill = (skill: SkillTag) => {
    if (!slash || !onSkillsChange) return;
    if (tagged.length >= MAX_SKILLS_PER_MESSAGE) {
      setFileError(`Tag up to ${MAX_SKILLS_PER_MESSAGE} skills per message.`);
      setDismissedAt(slash.start);
      return;
    }
    const { text, caret } = removeSlashQuery(message, slash);
    onSkillsChange((current) => current.some((item) => item.id === skill.id) ? current : [...current, { id: skill.id, name: skill.name }]);
    onMessageChange(text);
    setSlash(null);
    setFileError('');
    placeCaret(caret);
  };

  // The Skills button types a `/` at the caret, which opens the picker.
  const openPicker = () => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? message.length;
    const before = message.slice(0, caret);
    const insert = before && !/\s$/.test(before) ? ' /' : '/';
    const text = before + insert + message.slice(caret);
    onMessageChange(text);
    updateSlash(text, caret + insert.length);
    placeCaret(caret + insert.length);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [message]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (pickerOpen && slash) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (options.length) setActiveOption((active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        if (options.length) {
          event.preventDefault();
          tagSkill(options[active]);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedAt(slash.start);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!loading && !readingFiles && (message.trim() || attachments.length)) onSendMessage();
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setFileError('');
    const selected = Array.from(files);
    if (attachments.length + selected.length > 4) { setFileError('Attach up to 4 files.'); return; }
    if (selected.some((file) => file.size > 5 * 1024 * 1024 || file.size === 0)) { setFileError('Each file must be between 1 byte and 5 MB.'); return; }
    if (attachments.reduce((size, file) => size + file.size, 0) + selected.reduce((size, file) => size + file.size, 0) > 10 * 1024 * 1024) { setFileError('Files must total 10 MB or less.'); return; }
    if (selected.some((file) => !MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''])) { setFileError('Use PNG, JPG, WebP, GIF, PDF, DOCX, TXT, or MD files.'); return; }
    if (!userId || userId === 'guest') { setFileError('Sign in before attaching files.'); return; }
    setReadingFiles(true);
    try {
      const encoded = await Promise.all(selected.map((file) => uploadDocument(file, userId)));
      onAttachmentsChange((current) => [...current, ...encoded]);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not read file.');
    } finally {
      setReadingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="relative w-full">
      {pickerOpen && slash && (
        <div className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-white/[0.14] bg-[#242424] shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
          <p className="border-b border-white/[0.07] px-3 py-1.5 text-[11px] text-[#8f8b86]">Skills{tagged.length ? ` · ${tagged.length}/${MAX_SKILLS_PER_MESSAGE} tagged` : ''}</p>
          <ul id={pickerId} role="listbox" aria-label="Skills" className="max-h-64 overflow-y-auto py-1">
            {options.map((skill, index) => (
              <li
                key={skill.id}
                id={`${pickerId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveOption(index)}
                onClick={() => tagSkill(skill)}
                className={`cursor-pointer px-3 py-2 ${index === active ? 'bg-white/[0.08]' : ''}`}
              >
                <div className="font-mono text-[13px] text-[#eee]">/{skill.name}</div>
                <div className="truncate text-xs text-[#aaa6a2]">{skill.description}</div>
              </li>
            ))}
          </ul>
          {!options.length && <p className="px-3 py-2 text-xs text-[#aaa6a2]">
            {skillsLoading ? 'Loading skills…' : allSkills.length === 0 ? 'No skills yet. Create or import one in the Skills tab.' : slash.query ? `No skills match “/${slash.query}”.` : 'All your skills are already tagged.'}
          </p>}
        </div>
      )}
      <div className="rounded-[20px] border border-white/[0.14] bg-[#292929] shadow-[0_10px_28px_rgba(0,0,0,0.10)] transition-colors focus-within:border-white/[0.38] focus-within:ring-1 focus-within:ring-white/[0.12]">
        <textarea
          ref={textareaRef}
          aria-label="Message"
          placeholder={placeholder}
          value={message}
          onChange={(event) => { onMessageChange(event.target.value); updateSlash(event.target.value, event.target.selectionStart); }}
          onSelect={(event) => updateSlash(event.currentTarget.value, event.currentTarget.selectionStart)}
          onBlur={() => setSlash(null)}
          onKeyDown={handleKeyDown}
          aria-autocomplete={canTagSkills ? 'list' : undefined}
          aria-controls={pickerOpen ? pickerId : undefined}
          aria-activedescendant={pickerOpen && options.length ? `${pickerId}-${active}` : undefined}
          rows={1}
          className="block w-full min-h-[68px] max-h-[180px] resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-6 text-[#f2f0ed] placeholder:text-[#aaa6a3] focus:outline-none"
        />
        {(attachments.length > 0 || tagged.length > 0) && <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {tagged.map((skill) => <span key={skill.id} className="flex max-w-[210px] items-center gap-1 rounded-lg border border-[#c9b8ff]/25 bg-[#c9b8ff]/[0.08] py-1 pl-2 pr-1 font-mono text-xs text-[#d9ceff]">
            <Sparkles className="h-3 w-3 shrink-0" /><span className="truncate">/{skill.name}</span>
            <button type="button" aria-label={`Remove skill ${skill.name}`} onClick={() => onSkillsChange?.((current) => current.filter((item) => item.id !== skill.id))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/10"><X className="h-3 w-3" /></button>
          </span>)}
          {attachments.map((file, index) => <span key={`${file.name}-${index}`} className="flex max-w-[210px] items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.05] py-1 pl-2 pr-1 text-xs text-[#d8d5d1]">
            <Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{file.name}</span>
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onAttachmentsChange((current) => current.filter((_, item) => item !== index))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/10"><X className="h-3 w-3" /></button>
          </span>)}
        </div>}
        <div className="flex min-h-12 items-center gap-2 px-3 pb-3">
          <input ref={fileInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.txt,.md" aria-label="Choose files" className="sr-only" onChange={(event) => void addFiles(event.target.files)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || readingFiles} aria-label="Attach files" title="Attach files" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-40"><Paperclip className="h-[17px] w-[17px]" strokeWidth={1.8} /></button>
          {canTagSkills && <button type="button" onClick={openPicker} disabled={loading} aria-label="Tag a skill" title="Tag a skill (type /)" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-40"><Sparkles className="h-[17px] w-[17px]" strokeWidth={1.8} /></button>}
          <CouncilToggle />
          <div className="flex-1" />
          <div className="flex min-w-0 items-center gap-0.5">
            <ModelSelector />
            <ThinkingSelector />
          </div>
          <button
            type="button"
            onClick={loading ? onStopGenerating : onSendMessage}
            disabled={!loading && (readingFiles || (!message.trim() && attachments.length === 0))}
            aria-label={loading ? 'Stop generating' : 'Send message'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f0eeeb] text-[#1c1b19] transition-colors hover:bg-white disabled:bg-white/10 disabled:text-white/35 disabled:cursor-not-allowed"
          >
            {loading ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {fileError && <p role="alert" className="mt-2 px-2 text-xs text-red-300">{fileError}</p>}
      <LLMTokenIndicator isCouncilMode={councilMode} className="mt-2" />
    </div>
  );
};

export default MessageInput;
