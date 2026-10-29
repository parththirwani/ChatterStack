"use client";
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { ModelSelector } from './ModelSelector/ModelSelector';
import { ThinkingSelector } from './ModelSelector/ThinkingSelector';
import { CouncilToggle } from './CouncilToggle';
import AttachmentTile from '@/src/components/chat/attachments/AttachmentTile';
import DocumentPreview from '@/src/components/sidebar/resources/DocumentPreview';
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
  replyComplete?: boolean;
  onStopGenerating?: () => void;
  placeholder?: string;
  /** Rendered just above the input box, tucked behind its top edge. */
  queue?: React.ReactNode;
}

type SlashOption =
  | { kind: 'files'; key: string; label: string; description: string }
  | { kind: 'skill'; key: string; id: string; name: string; description: string };

/** A picked file that is still uploading, shown in place of the real tile. */
interface PendingUpload {
  key: string;
  file: File;
  previewUrl?: string;
  progress: number;
  status: 'uploading' | 'error';
  error?: string;
}

const FILES_OPTION: SlashOption = { kind: 'files', key: 'files', label: 'Add files', description: 'Images, PDF, DOCX, TXT or MD' };

// Must match the textarea's box and type exactly, so the highlighted copy
// behind it lines up character for character.
const TEXT_BOX = 'px-5 pt-4 pb-2 text-[15px] leading-6 whitespace-pre-wrap break-words';

const MessageInput: React.FC<MessageInputProps> = ({ message, onMessageChange, attachments, onAttachmentsChange, onSendMessage, loading, replyComplete = false, onStopGenerating, placeholder = 'Ask anything', queue }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [preview, setPreview] = useState<{ id: string; name: string; mimeType: string } | null>(null);
  const objectUrls = useRef<string[]>([]);
  // Keeps the already-decoded local preview on screen after the upload
  // finishes, so the tile does not flash while the saved file loads.
  const previewsByDocument = useRef(new Map<string, string>());
  // The picked files, so a just-uploaded document previews without being
  // downloaded back from storage.
  const filesByDocument = useRef(new Map<string, File>());
  // Uploads the user dismissed while they were still in flight.
  const cancelledUploads = useRef(new Set<string>());
  const uploading = pending.some((file) => file.status === 'uploading');

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

  // Once an attachment is removed or sent, nothing needs its local copy.
  useEffect(() => {
    const live = new Set(attachments.map((file) => file.documentId));
    previewsByDocument.current.forEach((url, id) => {
      if (live.has(id)) return;
      URL.revokeObjectURL(url);
      objectUrls.current = objectUrls.current.filter((entry) => entry !== url);
      previewsByDocument.current.delete(id);
    });
    filesByDocument.current.forEach((_file, id) => {
      if (!live.has(id)) filesByDocument.current.delete(id);
    });
  }, [attachments]);

  // Local previews outlive the upload, so release them when the composer goes.
  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
  }, []);

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
      // While a reply streams, sending puts the message in the queue.
      if (!uploading && (message.trim() || attachments.length)) onSendMessage();
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setFileError('');
    const selected = Array.from(files);
    if (attachments.length + pending.length + selected.length > 4) { setFileError('Attach up to 4 files.'); return; }
    if (selected.some((file) => file.size > 5 * 1024 * 1024 || file.size === 0)) { setFileError('Each file must be between 1 byte and 5 MB.'); return; }
    if (attachments.reduce((size, file) => size + file.size, 0) + selected.reduce((size, file) => size + file.size, 0) > 10 * 1024 * 1024) { setFileError('Files must total 10 MB or less.'); return; }
    if (selected.some((file) => !MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''])) { setFileError('Use PNG, JPG, WebP, GIF, PDF, DOCX, TXT, or MD files.'); return; }
    if (!userId || userId === 'guest') { setFileError('Sign in before attaching files.'); return; }

    // The tiles appear before the first byte leaves the browser: images from
    // a local object URL, everything else as a labelled skeleton.
    const batch: PendingUpload[] = selected.map((file) => {
      const mimeType = MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''];
      const previewUrl = mimeType.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      if (previewUrl) objectUrls.current.push(previewUrl);
      return { key: crypto.randomUUID(), file, previewUrl, progress: 0, status: 'uploading' };
    });
    setPending((current) => [...current, ...batch]);

    const results = await Promise.allSettled(batch.map(async (item) => {
      const attachment = await uploadDocument(item.file, userId, (progress) => {
        setPending((current) => current.map((entry) => (entry.key === item.key ? { ...entry, progress } : entry)));
      });
      return { key: item.key, attachment };
    }));

    const saved: DocumentAttachment[] = [];
    const failures: { key: string; message: string }[] = [];
    results.forEach((result, index) => {
      const { key } = batch[index];
      if (result.status === 'fulfilled') {
        if (cancelledUploads.current.has(key)) return;
        saved.push(result.value.attachment);
        const { previewUrl, file } = batch[index];
        if (previewUrl) previewsByDocument.current.set(result.value.attachment.documentId, previewUrl);
        filesByDocument.current.set(result.value.attachment.documentId, file);
      } else {
        failures.push({ key, message: result.reason instanceof Error ? result.reason.message : 'Could not upload file.' });
      }
    });

    if (saved.length) onAttachmentsChange((current) => {
      // Identical files dedupe to one saved document; attach it once.
      const seen = new Set(current.map((file) => file.documentId));
      return [...current, ...saved.filter((file) => !seen.has(file.documentId) && (seen.add(file.documentId), true))];
    });
    setPending((current) => current
      .filter((entry) => !batch.some((item) => item.key === entry.key) || failures.some((failure) => failure.key === entry.key))
      .map((entry) => {
        const failure = failures.find((item) => item.key === entry.key);
        return failure ? { ...entry, status: 'error' as const, error: failure.message } : entry;
      }));

    if (failures.length) setFileError(failures[0].message);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePending = (key: string) => {
    cancelledUploads.current.add(key);
    setPending((current) => {
      const removed = current.find((entry) => entry.key === key);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        objectUrls.current = objectUrls.current.filter((url) => url !== removed.previewUrl);
      }
      return current.filter((entry) => entry.key !== key);
    });
  };

  const hasContent = Boolean(message.trim()) || attachments.length > 0;
  // Streaming with something typed: the button queues it. Streaming with an
  // empty box: the button stops the reply.
  const showStop = loading && !replyComplete && !hasContent;

  return (
    <div className="w-full">
      {queue}
      <div className="relative rounded-[20px] border border-white/[0.14] bg-[#292929] shadow-[0_10px_28px_rgba(0,0,0,0.10)] transition-colors focus-within:border-white/[0.38] focus-within:ring-1 focus-within:ring-white/[0.12]">
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
        {(attachments.length > 0 || pending.length > 0) && <div role="list" aria-label="Attachments" aria-busy={uploading} className="flex flex-wrap items-start gap-2 px-4 pb-2 pt-1">
          {attachments.map((file) => <AttachmentTile
            key={file.documentId}
            name={file.name}
            mimeType={file.mimeType}
            sourceUrl={`/api/documents/${file.documentId}/content?preview=1`}
            previewUrl={previewsByDocument.current.get(file.documentId)}
            onOpen={() => setPreview({ id: file.documentId, name: file.name, mimeType: file.mimeType })}
            onRemove={() => onAttachmentsChange((current) => current.filter((item) => item.documentId !== file.documentId))}
          />)}
          {pending.map((file) => <AttachmentTile
            key={file.key}
            name={file.file.name}
            mimeType={MIME_BY_EXTENSION[file.file.name.split('.').pop()?.toLowerCase() ?? ''] ?? file.file.type}
            previewUrl={file.previewUrl}
            progress={file.progress}
            uploading={file.status === 'uploading'}
            error={file.error}
            onRemove={() => removePending(file.key)}
          />)}
          {uploading && <span role="status" className="sr-only">
            Uploading {pending.filter((file) => file.status === 'uploading').length} file{pending.filter((file) => file.status === 'uploading').length === 1 ? '' : 's'}…
          </span>}
        </div>}
        <div className="flex min-h-12 items-center gap-2 px-3 pb-3">
          <input ref={fileInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.txt,.md" aria-label="Choose files" className="sr-only" onChange={(event) => void addFiles(event.target.files)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} aria-label="Attach files" title="Attach files" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-40"><Paperclip className="h-[17px] w-[17px]" strokeWidth={1.8} /></button>
          <CouncilToggle />
          <div className="flex-1" />
          <div className="flex min-w-0 items-center gap-0.5">
            <ModelSelector />
            <ThinkingSelector />
          </div>
          <button
            type="button"
            onClick={showStop ? onStopGenerating : onSendMessage}
            disabled={!showStop && (uploading || !hasContent)}
            aria-label={showStop ? 'Stop generating' : loading ? 'Queue message' : 'Send message'}
            title={loading && !showStop ? 'Queue message' : undefined}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 ${showStop ? 'bg-[#e5484d] text-white hover:bg-[#ec5d61]' : 'bg-[#f0eeeb] text-[#1c1b19] hover:bg-white'}`}
          >
            {showStop ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {fileError && <p role="alert" className="mt-2 px-2 text-xs text-red-300">{fileError}</p>}
      {preview && <DocumentPreview document={preview} localFile={filesByDocument.current.get(preview.id)} onClose={() => setPreview(null)} />}
    </div>
  );
};

export default MessageInput;
