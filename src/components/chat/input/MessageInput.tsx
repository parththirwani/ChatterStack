"use client";
import React, { useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { ModelSelector } from './ModelSelector/ModelSelector';

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
  placeholder = "Message AI chat...",
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
    <div className="relative bg-gray-800/40 backdrop-blur-xl border border-gray-700/50 rounded-[20px] shadow-2xl transition-all duration-300 focus-within:border-yellow-500/40 focus-within:shadow-yellow-500/20">
      <div className="relative p-4">
        {/* Model Selector - Clean Single Element */}
        <div className="mb-3">
          <ModelSelector />
        </div>

        {/* Main Input Area */}
        <div className="flex items-end gap-3">
          {/* Text Input */}
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              placeholder={placeholder}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              onInput={handleInput}
              onKeyPress={handleKeyPress}
              disabled={loading}
              rows={1}
              className="w-full text-white placeholder-gray-500 bg-transparent px-2 py-2 resize-none min-h-[40px] max-h-[200px] focus:outline-none outline-none border-none"
              style={{ outline: 'none' }}
            />
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={loading || !message.trim()}
            className="flex-shrink-0 bg-gradient-to-br from-yellow-500 to-yellow-600 text-black p-2.5 rounded-xl hover:from-yellow-400 hover:to-yellow-500 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:from-yellow-500 disabled:hover:to-yellow-600 shadow-lg hover:shadow-yellow-500/50 hover:-translate-y-0.5 cursor-pointer outline-none focus:outline-none"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MessageInput;