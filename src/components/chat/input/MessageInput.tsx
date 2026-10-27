"use client";
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { ModelSelector } from './ModelSelector/ModelSelector';
import { ThinkingSelector } from './ModelSelector/ThinkingSelector';
import { CouncilToggle } from './CouncilToggle';
import LLMTokenIndicator from '../../rate-limit/LLMTokenIndicator';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import type { DocumentAttachment } from '@/src/types/chat.types';
import { MIME_BY_EXTENSION, uploadDocument } from '@/src/lib/client/documents';
import { useAppStore } from '@/src/store/rootStore';

interface MessageInputProps {
  message: string;
  onMessageChange: (message: string) => void;
  attachments: DocumentAttachment[];
  onAttachmentsChange: React.Dispatch<React.SetStateAction<DocumentAttachment[]>>;
  onSendMessage: () => void;
  loading: boolean;
  onStopGenerating?: () => void;
  placeholder?: string;
  /** Rendered just above the input box, tucked behind its top edge. */
  queue?: React.ReactNode;
}

const MessageInput: React.FC<MessageInputProps> = ({ message, onMessageChange, attachments, onAttachmentsChange, onSendMessage, loading, onStopGenerating, placeholder = 'Ask anything', queue }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const [readingFiles, setReadingFiles] = useState(false);
  const { councilMode } = useModelSelection();
  const userId = useAppStore((state) => state.user?.id);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [message]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // While a reply streams, sending puts the message in the queue.
      if (!readingFiles && (message.trim() || attachments.length)) onSendMessage();
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

  const hasContent = Boolean(message.trim()) || attachments.length > 0;
  // Streaming with something typed: the button queues it. Streaming with an
  // empty box: the button stops the reply.
  const showStop = loading && !hasContent;

  return (
    <div className="w-full">
      {queue}
      <div className="relative rounded-[20px] border border-white/[0.14] bg-[#292929] shadow-[0_10px_28px_rgba(0,0,0,0.10)] transition-colors focus-within:border-white/[0.38] focus-within:ring-1 focus-within:ring-white/[0.12]">
        <textarea
          ref={textareaRef}
          aria-label="Message"
          placeholder={placeholder}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          className="block w-full min-h-[68px] max-h-[180px] resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-6 text-[#f2f0ed] placeholder:text-[#aaa6a3] focus:outline-none"
        />
        {attachments.length > 0 && <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {attachments.map((file, index) => <span key={`${file.name}-${index}`} className="flex max-w-[210px] items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.05] py-1 pl-2 pr-1 text-xs text-[#d8d5d1]">
            <Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{file.name}</span>
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onAttachmentsChange((current) => current.filter((_, item) => item !== index))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/10"><X className="h-3 w-3" /></button>
          </span>)}
        </div>}
        <div className="flex min-h-12 items-center gap-2 px-3 pb-3">
          <input ref={fileInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.txt,.md" aria-label="Choose files" className="sr-only" onChange={(event) => void addFiles(event.target.files)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={readingFiles} aria-label="Attach files" title="Attach files" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-40"><Paperclip className="h-[17px] w-[17px]" strokeWidth={1.8} /></button>
          <CouncilToggle />
          <div className="flex-1" />
          <div className="flex min-w-0 items-center gap-0.5">
            <ModelSelector />
            <ThinkingSelector />
          </div>
          <button
            type="button"
            onClick={showStop ? onStopGenerating : onSendMessage}
            disabled={!showStop && (readingFiles || !hasContent)}
            aria-label={showStop ? 'Stop generating' : loading ? 'Queue message' : 'Send message'}
            title={loading && !showStop ? 'Queue message' : undefined}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 ${showStop ? 'bg-[#e5484d] text-white hover:bg-[#ec5d61]' : 'bg-[#f0eeeb] text-[#1c1b19] hover:bg-white'}`}
          >
            {showStop ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {fileError && <p role="alert" className="mt-2 px-2 text-xs text-red-300">{fileError}</p>}
      <LLMTokenIndicator isCouncilMode={councilMode} className="mt-2" />
    </div>
  );
};

export default MessageInput;
