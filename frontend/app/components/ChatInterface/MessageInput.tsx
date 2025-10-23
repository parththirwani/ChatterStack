"use client";

import React, { useRef, useState } from 'react';
import { Send, Loader2, Plus } from 'lucide-react';
import Image from 'next/image';
import { useModelSelection, AVAILABLE_MODELS } from '@/app/context/ModelSelectionContext';

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
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const { selectedModels, toggleModel, isModelSelected } = useModelSelection();

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

  const toggleModelSelector = () => {
    setIsModelSelectorOpen((prev) => !prev);
  };

  return (
    <div className="relative bg-[#282230] border border-gray-700/50 rounded-2xl backdrop-blur-sm">
      <div className="relative p-2 flex items-center">
        <button
          onClick={toggleModelSelector}
          className="absolute left-3 bottom-3 bg-gray-700 text-white p-2 rounded-lg hover:bg-gray-600 transition-all duration-200"
          title="Select Models"
        >
          <Plus className="w-4 h-4" />
        </button>

        <textarea
          ref={textareaRef}
          placeholder={placeholder}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          onInput={handleInput}
          onKeyPress={handleKeyPress}
          disabled={loading}
          rows={1}
          className="w-full text-white placeholder-gray-400 bg-transparent px-12 py-2 pr-12 resize-none min-h-[40px] max-h-[120px] focus:outline-none"
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

      {isModelSelectorOpen && (
        <div className="absolute bottom-14 left-2 w-64 bg-[#282230] border border-gray-700/50 rounded-lg shadow-lg p-3 z-20">
          <div className="space-y-2">
            {AVAILABLE_MODELS.map((model) => {
              const isSelected = isModelSelected(model.id);
              const isLastSelected = selectedModels.size === 1 && isSelected;

              return (
                <div
                  key={model.id}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-700/50"
                >
                  <div className="flex items-center gap-2">
                    <Image
                      src={model.logo}
                      alt={`${model.company} logo`}
                      width={20}
                      height={20}
                      className={model.company === 'OpenAI' ? 'invert brightness-0' : ''}
                    />
                    <span className="text-sm text-white">{model.name}</span>
                  </div>
                  <button
                    onClick={() => !isLastSelected && toggleModel(model.id)}
                    disabled={isLastSelected}
                    className={`relative w-10 h-5 rounded-full transition-all ${
                      isSelected ? 'bg-yellow-500' : 'bg-gray-600'
                    } ${isLastSelected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    title={isLastSelected ? 'At least one model must be selected' : undefined}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        isSelected ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageInput;