"use client";
import React, { useEffect, useRef } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { ModelSelector } from './ModelSelector/ModelSelector';
import { ThinkingSelector } from './ModelSelector/ThinkingSelector';
import { CouncilToggle } from './CouncilToggle';
import LLMTokenIndicator from '../../rate-limit/LLMTokenIndicator';
import { useModelSelection } from '@/src/context/ModelSelectionContext';

interface MessageInputProps {
  message: string;
  onMessageChange: (message: string) => void;
  onSendMessage: () => void;
  loading: boolean;
  onStopGenerating?: () => void;
  placeholder?: string;
}

const MessageInput: React.FC<MessageInputProps> = ({ message, onMessageChange, onSendMessage, loading, onStopGenerating, placeholder = 'Ask anything' }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { councilMode } = useModelSelection();

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
      if (!loading && message.trim()) onSendMessage();
    }
  };

  return (
    <div className="w-full">
      <div className="rounded-[20px] border border-white/[0.14] bg-[#292929] shadow-[0_10px_28px_rgba(0,0,0,0.10)] transition-colors focus-within:border-white/[0.38] focus-within:ring-1 focus-within:ring-white/[0.12]">
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
        <div className="flex min-h-12 items-center gap-2 px-3 pb-3">
          <CouncilToggle />
          <div className="flex-1" />
          <div className="flex min-w-0 items-center gap-0.5">
            <ModelSelector />
            <ThinkingSelector />
          </div>
          <button
            type="button"
            onClick={loading ? onStopGenerating : onSendMessage}
            disabled={!loading && !message.trim()}
            aria-label={loading ? 'Stop generating' : 'Send message'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f0eeeb] text-[#1c1b19] transition-colors hover:bg-white disabled:bg-white/10 disabled:text-white/35 disabled:cursor-not-allowed"
          >
            {loading ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <LLMTokenIndicator isCouncilMode={councilMode} className="mt-2" />
    </div>
  );
};

export default MessageInput;
