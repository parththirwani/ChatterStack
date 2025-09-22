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
  placeholder = "Enter your message here",
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
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  const handleSend = () => {
    onSendMessage();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className="relative bg-[#282230] border border-gray-700/50 rounded-2xl backdrop-blur-sm">
      <div className="relative p-2">
        <textarea
          ref={textareaRef}
          placeholder={placeholder}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          onInput={handleInput}
          onKeyPress={handleKeyPress}
          disabled={loading}
          rows={1}
          className="w-full text-white placeholder-gray-400 bg-transparent px-3 py-2 pr-12 resize-none min-h-[40px] max-h-[120px] focus:outline-none"
        />
        <button
          onClick={handleSend}
          disabled={loading || !message.trim()}
          className="absolute right-3 bottom-3 bg-white text-gray-900 p-2 rounded-lg hover:bg-gray-100 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};

export default MessageInput;