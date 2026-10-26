"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import { ModelDropdown } from './ModelDropDown';

export const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { selectedModel, setSelectedModel, getModelInfo } = useModelSelection();
  const currentModel = getModelInfo(selectedModel);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen) rootRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [isOpen]);

  const openMenu = () => {
    const bottom = triggerRef.current?.getBoundingClientRect().bottom ?? 0;
    setPlacement(window.innerHeight - bottom >= 365 ? 'down' : 'up');
    setIsOpen(true);
  };
  
  return (
    <div ref={rootRef} className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
    }}>
      <button 
        ref={triggerRef}
        onClick={() => isOpen ? setIsOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu();
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
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-[#cfcbc5] transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        {/* Model Name */}
        <span className="font-medium">
          {currentModel?.name || 'Select Model'}
        </span>
        
        {/* Chevron */}
        <ChevronDown className={`w-3 h-3 text-[#aaa6a2] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && <ModelDropdown
        placement={placement}
        selectedModel={selectedModel}
        onSelect={setSelectedModel}
        onClose={() => setIsOpen(false)}
        onReturnFocus={() => triggerRef.current?.focus()}
      />}
    </div>
  );
};
