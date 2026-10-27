"use client";
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { ModelSelector } from './ModelSelector/ModelSelector';
import { ThinkingSelector } from './ModelSelector/ThinkingSelector';
import { CouncilToggle } from './CouncilToggle';
import LLMTokenIndicator from '../../rate-limit/LLMTokenIndicator';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import type { DocumentAttachment } from '@/src/types/chat.types';
import { MIME_BY_EXTENSION, uploadDocument } from '@/src/lib/client/documents';
import { useAppStore } from '@/src/store/rootStore';
import { useSkills } from '@/src/lib/client/skills';
import { MAX_SKILLS_PER_MESSAGE } from '@/src/lib/skills/skill-file';
import { matchSkills, removeSlashQuery, skillsInText, slashQueryAt, splitSkillTokens, type SlashQuery } from '@/src/lib/skills/slash';

interface MessageInputProps {
  message: string;
  onMessageChange: (message: string) => void;
  attachments: DocumentAttachment[];
  onAttachmentsChange: React.Dispatch<React.SetStateAction<DocumentAttachment[]>>;
  onSendMessage: () => void;
  loading: boolean;
  onStopGenerating?: () => void;
  placeholder?: string;
}

type SlashOption =
  | { kind: 'files'; key: string; label: string; description: string }
  | { kind: 'skill'; key: string; id: string; name: string; description: string };

const FILES_OPTION: SlashOption = { kind: 'files', key: 'files', label: 'Add files', description: 'Images, PDF, DOCX, TXT or MD' };

// Must match the textarea's box and type exactly, so the highlighted copy
// behind it lines up character for character.
const TEXT_BOX = 'px-5 pt-4 pb-2 text-[15px] leading-6 whitespace-pre-wrap break-words';

const MessageInput: React.FC<MessageInputProps> = ({ message, onMessageChange, attachments, onAttachmentsChange, onSendMessage, loading, onStopGenerating, placeholder = 'Ask anything' }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const [readingFiles, setReadingFiles] = useState(false);
  const { councilMode } = useModelSelection();
  const userId = useAppStore((state) => state.user?.id);
  const signedIn = !!userId && userId !== 'guest';
  const { skills: allSkills, loading: skillsLoading } = useSkills(signedIn ? userId : null);
  // Only turned-on skills can be used, as in Claude's / menu.
  const enabledSkills = useMemo(() => allSkills.filter((skill) => skill.enabled), [allSkills]);
  const skillNames = useMemo(() => new Set(enabledSkills.map((skill) => skill.name)), [enabledSkills]);
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  // The `/` the user dismissed with Escape; the menu stays closed for it.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const pickerId = useId();

  const tokenParts = useMemo(() => splitSkillTokens(message, skillNames), [message, skillNames]);
  const hasTokens = tokenParts.some((part) => part.skill);
  const pickerOpen = signedIn && !!slash && dismissedAt !== slash.start;
  const options = useMemo((): SlashOption[] => {
    if (!pickerOpen || !slash) return [];
    // Skills already in the text, not counting the `/query` being typed.
    const tagged = new Set(skillsInText(removeSlashQuery(message, slash).text, enabledSkills).map((skill) => skill.id));
    const actions = 'add files'.includes(slash.query.replace(/-/g, ' ')) ? [FILES_OPTION] : [];
    const skills = matchSkills(enabledSkills.filter((skill) => !tagged.has(skill.id)), slash.query, 8)
      .map((skill): SlashOption => ({ kind: 'skill', key: skill.id, id: skill.id, name: skill.name, description: skill.description }));
    return [...actions, ...skills];
  }, [pickerOpen, slash, message, enabledSkills]);
  const active = Math.min(activeOption, Math.max(options.length - 1, 0));

  const updateSlash = (text: string, caret: number | null) => {
    const next = caret === null ? null : slashQueryAt(text, caret);
    setSlash((current) => (current?.start === next?.start && current?.end === next?.end && current?.query === next?.query ? current : next));
    if (next?.start !== slash?.start) setActiveOption(0);
    if (!next || next.start !== dismissedAt) setDismissedAt(null);
  };

  // Applied right after the text update renders, before the next keystroke
  // can land in the wrong place.
  const pendingCaret = useRef<number | null>(null);
  const placeCaret = (position: number) => {
    pendingCaret.current = position;
  };
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (pendingCaret.current === null || !el) return;
    el.focus();
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [message]);

  const choose = (option: SlashOption) => {
    if (!slash) return;
    const { text, caret } = removeSlashQuery(message, slash);
    if (option.kind === 'files') {
      onMessageChange(text);
      setSlash(null);
      placeCaret(caret);
      fileInputRef.current?.click();
      return;
    }
    if (skillsInText(text, enabledSkills).length >= MAX_SKILLS_PER_MESSAGE) {
      setFileError(`Use up to ${MAX_SKILLS_PER_MESSAGE} skills per message.`);
      setDismissedAt(slash.start);
      return;
    }
    // The skill stays in the text as an inline `/name` token.
    const token = `/${option.name} `;
    const next = text.slice(0, caret) + token + text.slice(caret).replace(/^ /, '');
    onMessageChange(next);
    setSlash(null);
    setFileError('');
    placeCaret(caret + token.length);
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
          choose(options[active]);
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
        <div className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-white/[0.14] bg-[#242424] py-1 shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
          <ul id={pickerId} role="listbox" aria-label="Skills and actions" className="max-h-72 overflow-y-auto">
            {options.map((option, index) => (
              <li
                key={option.key}
                id={`${pickerId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveOption(index)}
                onClick={() => choose(option)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 ${index === active ? 'bg-white/[0.08]' : ''} ${option.kind === 'files' && options[index + 1] ? 'mb-1 border-b border-white/[0.07] pb-2' : ''}`}
              >
                {option.kind === 'files'
                  ? <Paperclip className="h-4 w-4 shrink-0 text-[#aaa6a2]" />
                  : <span aria-hidden="true" className="w-4 shrink-0 text-center font-mono text-sm text-[#8f8b86]">/</span>}
                <span className="min-w-0">
                  <span className="block text-[13px] text-[#eee]">{option.kind === 'files' ? option.label : option.name}</span>
                  <span className="block truncate text-xs text-[#8f8b86]">{option.description}</span>
                </span>
              </li>
            ))}
          </ul>
          {!options.length && <p className="px-3 py-2 text-xs text-[#aaa6a2]">
            {skillsLoading ? 'Loading skills…' : enabledSkills.length === 0 ? 'No skills turned on. Add some in Customize.' : `No skills match “/${slash.query}”.`}
          </p>}
        </div>
      )}
      <div className="rounded-[20px] border border-white/[0.14] bg-[#292929] shadow-[0_10px_28px_rgba(0,0,0,0.10)] transition-colors focus-within:border-white/[0.38] focus-within:ring-1 focus-within:ring-white/[0.12]">
        <div className="relative">
          {/* Skill tokens are highlighted in a copy of the text drawn behind
              the (then transparent) textarea, as claude.ai shows them inline. */}
          {hasTokens && <div ref={mirrorRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden text-[#f2f0ed] ${TEXT_BOX}`}>
            {tokenParts.map((part, index) => part.skill
              ? <span key={index} data-skill-token={part.skill} className="rounded bg-[#c9b8ff]/[0.14] text-[#d9ceff]">{part.text}</span>
              : <span key={index}>{part.text}</span>)}
            {/* Keeps a trailing newline's line height. */}
            {'\u200b'}
          </div>}
          <textarea
            ref={textareaRef}
            aria-label="Message"
            placeholder={placeholder}
            value={message}
            onChange={(event) => { onMessageChange(event.target.value); updateSlash(event.target.value, event.target.selectionStart); }}
            onSelect={(event) => updateSlash(event.currentTarget.value, event.currentTarget.selectionStart)}
            onScroll={(event) => { if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop; }}
            onBlur={() => setSlash(null)}
            onKeyDown={handleKeyDown}
            aria-autocomplete={signedIn ? 'list' : undefined}
            aria-controls={pickerOpen ? pickerId : undefined}
            aria-activedescendant={pickerOpen && options.length ? `${pickerId}-${active}` : undefined}
            rows={1}
            className={`relative block w-full min-h-[68px] max-h-[180px] resize-none bg-transparent ${TEXT_BOX} placeholder:text-[#aaa6a3] caret-[#f2f0ed] focus:outline-none ${hasTokens ? 'text-transparent selection:bg-white/25' : 'text-[#f2f0ed]'}`}
          />
        </div>
        {attachments.length > 0 && <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {attachments.map((file, index) => <span key={`${file.name}-${index}`} className="flex max-w-[210px] items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.05] py-1 pl-2 pr-1 text-xs text-[#d8d5d1]">
            <Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{file.name}</span>
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onAttachmentsChange((current) => current.filter((_, item) => item !== index))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/10"><X className="h-3 w-3" /></button>
          </span>)}
        </div>}
        <div className="flex min-h-12 items-center gap-2 px-3 pb-3">
          <input ref={fileInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.txt,.md" aria-label="Choose files" className="sr-only" onChange={(event) => void addFiles(event.target.files)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || readingFiles} aria-label="Attach files" title="Attach files" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-40"><Paperclip className="h-[17px] w-[17px]" strokeWidth={1.8} /></button>
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
