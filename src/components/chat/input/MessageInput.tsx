"use client";
import React, { useEffect, useRef } from 'react';
import { Send, Square } from 'lucide-react';
import { ModelSelector } from './ModelSelector/ModelSelector';
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

const MessageInput: React.FC<MessageInputProps> = ({
  message,
  onMessageChange,
  onSendMessage,
  loading,
  onStopGenerating,
  placeholder = "Message AI chat...",
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { selectedModel } = useModelSelection();
  const isCouncilMode = selectedModel === 'council';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading) {
        onSendMessage();
      }
    }
  };

  // Resize when the message changes (covers programmatic prefill and clear too)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [message]);

  const handleSend = () => {
    onSendMessage();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className="relative bg-gray-800/40 backdrop-blur-xl border border-gray-700/50 rounded-2xl sm:rounded-[20px] shadow-2xl transition-all duration-300 focus-within:border-yellow-500/40 focus-within:shadow-yellow-500/20">
      <div className="relative p-3 sm:p-4">
        <LLMTokenIndicator isCouncilMode={isCouncilMode} className="mb-3" />

        <div className="mb-2 sm:mb-3">
          <ModelSelector />
        </div>

        <div className="flex items-end gap-2 sm:gap-3">
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              placeholder={placeholder}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              className="w-full text-white placeholder-gray-500 bg-transparent px-1 sm:px-2 py-2 resize-none min-h-[40px] max-h-[200px] focus:outline-none outline-none border-none text-sm sm:text-base"
              style={{ outline: 'none' }}
            />
          </div>

          {loading ? (
            <button
              onClick={onStopGenerating}
              className="flex-shrink-0 bg-gradient-to-br from-yellow-500 to-yellow-600 text-black p-2.5 sm:p-3 rounded-xl hover:from-yellow-400 hover:to-yellow-500 transition-all duration-200 cursor-pointer outline-none focus:outline-none active:scale-95 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Stop generating"
            >
              <Square className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!message.trim()}
              className="flex-shrink-0 bg-gradient-to-br from-yellow-500 to-yellow-600 text-black p-2.5 sm:p-3 rounded-xl hover:from-yellow-400 hover:to-yellow-500 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:from-yellow-500 disabled:hover:to-yellow-600 shadow-lg hover:shadow-yellow-500/50 hover:-translate-y-0.5 cursor-pointer outline-none focus:outline-none active:scale-95 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageInput;
