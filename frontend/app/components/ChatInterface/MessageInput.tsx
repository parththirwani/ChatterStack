"use client";

import React, { useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface MessageInputProps {
  message: string;
  onMessageChange: (message: string) => void;
  onSendMessage: () => void;
  loading: boolean;
  placeholder?: string;
}

const MessageInput: React.FC<MessageInputProps> = ({
  message,
  onMessageChange,
  onSendMessage,
  loading,
  placeholder = "Message ChatterStack...",
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
  };

  const handleSend = () => {
    onSendMessage();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className="relative bg-[#282230] border border-gray-700/50 rounded-2xl backdrop-blur-sm shadow-lg">
      <div className="relative p-3 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          placeholder={placeholder}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          onInput={handleInput}
          onKeyPress={handleKeyPress}
          disabled={loading}
          rows={1}
          className="flex-1 text-white placeholder-gray-500 bg-transparent px-2 py-2 resize-none min-h-[40px] max-h-[200px] focus:outline-none"
        />

        <button
          onClick={handleSend}
          disabled={loading || !message.trim()}
          className="flex-shrink-0 bg-yellow-500 text-black p-2.5 rounded-xl hover:bg-yellow-400 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-yellow-500 shadow-sm"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
};

export default MessageInput;