"use client";

import React, { useRef, useState, useEffect } from 'react';
import { Send, Loader2, ChevronDown, Crown } from 'lucide-react';
import Image from 'next/image';
import { AVAILABLE_MODELS, useModelSelection } from '../../context/ModelSelectionContext';


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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const { selectedModel, setSelectedModel, getModelInfo } = useModelSelection();
  
  const currentModel = getModelInfo(selectedModel);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelSelectorOpen(false);
      }
    };

    if (isModelSelectorOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelSelectorOpen]);

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

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId as any);
    setIsModelSelectorOpen(false);
  };

  return (
    <div className="relative bg-[#282230] border border-gray-700/50 rounded-2xl backdrop-blur-sm shadow-lg">
      <div className="relative p-3 flex items-end gap-2">
        {/* Model Selector Button */}
        <div className="relative flex-shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 transition-colors text-xs cursor-pointer"
            title="Select AI Model"
          >
            {currentModel && (
              <Image
                src={currentModel.logo}
                alt={currentModel.name}
                width={14}
                height={14}
                className={currentModel.company === 'OpenAI' ? 'invert brightness-0' : ''}
              />
            )}
            <span className="text-gray-300 max-w-[80px] truncate">
              {currentModel?.name || 'Model'}
            </span>
            {currentModel?.isPro && (
              <Crown className="w-3 h-3 text-yellow-500" />
            )}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isModelSelectorOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Model Dropdown */}
          {isModelSelectorOpen && (
            <div className="absolute bottom-full mb-2 left-0 w-72 bg-[#282230] border border-gray-700/50 rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="p-2 max-h-80 overflow-y-auto">
                {AVAILABLE_MODELS.map((model) => {
                  const isSelected = selectedModel === model.id;
                  
                  return (
                    <button
                      key={model.id}
                      onClick={() => handleModelSelect(model.id)}
                      className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-yellow-500/20 border border-yellow-500/50'
                          : 'hover:bg-gray-700/50 border border-transparent'
                      }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <Image
                          src={model.logo}
                          alt={model.name}
                          width={20}
                          height={20}
                          className={model.company === 'OpenAI' ? 'invert brightness-0' : ''}
                        />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <div className={`text-sm font-medium ${isSelected ? 'text-yellow-400' : 'text-white'}`}>
                            {model.name}
                          </div>
                          {model.isPro && (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 border border-yellow-500/30 rounded text-xs text-yellow-400">
                              <Crown className="w-3 h-3" />
                              <span>Pro</span>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {model.description}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="flex-shrink-0">
                          <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Text Input */}
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

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={loading || !message.trim()}
          className="flex-shrink-0 bg-yellow-500 text-black p-2.5 rounded-xl hover:bg-yellow-400 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-yellow-500 shadow-sm cursor-pointer"
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