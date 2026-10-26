"use client";
import React, { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import { ModelDropdown } from './ModelDropDown';

export const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { selectedModel, setSelectedModel, getModelInfo } = useModelSelection();
  const currentModel = getModelInfo(selectedModel);
  
  return (
    <div className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
    }}>
      <button 
        ref={triggerRef}
        onClick={() => {
          setIsOpen((open) => !open);
          if (!isOpen) requestAnimationFrame(() => document.querySelector<HTMLElement>('#chat-model-listbox [aria-selected="true"]')?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            requestAnimationFrame(() => document.querySelector<HTMLElement>('#chat-model-listbox [aria-selected="true"]')?.focus());
          }
          if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            setIsOpen(false);
          }
        }}
        aria-label={`Model: ${currentModel?.name || 'Select model'}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="chat-model-listbox"
        className="flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] text-[#d1ccc6] transition-colors hover:bg-white/[0.07] hover:text-white"
      >
        {/* Model Icon */}
        {currentModel && (
          <div className="w-4 h-4 flex items-center justify-center">
            <Image
              src={currentModel.logo}
              alt=""
              width={14}
              height={14}
              className={currentModel.company === 'OpenAI' ? 'invert brightness-0' : ''}
            />
          </div>
        )}
        
        {/* Model Name */}
        <span className="font-medium">
          {currentModel?.name || 'Select Model'}
        </span>
        
        {/* Chevron */}
        <ChevronDown className={`w-3 h-3 text-[#aaa6a2] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <>
          {/* Backdrop to close dropdown */}
          <div 
            className="fixed inset-0 z-40 bg-black/55 md:bg-transparent"
            onClick={() => setIsOpen(false)}
          />
          <div className="relative z-50">
            <ModelDropdown
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
              onClose={() => setIsOpen(false)}
              onReturnFocus={() => triggerRef.current?.focus()}
            />
          </div>
        </>
      )}
    </div>
  );
};
