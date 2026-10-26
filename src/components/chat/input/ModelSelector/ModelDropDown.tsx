"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Check } from 'lucide-react';
import { AVAILABLE_MODELS, type ModelId } from '@/src/context/ModelSelectionContext';

interface ModelDropdownProps {
  placement: 'down' | 'up';
  selectedModel: ModelId;
  onSelect: (modelId: ModelId) => void;
  onClose: () => void;
  onReturnFocus: () => void;
}

export const ModelDropdown: React.FC<ModelDropdownProps> = ({
  placement,
  selectedModel,
  onSelect,
  onClose,
  onReturnFocus,
}) => {
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, AVAILABLE_MODELS.findIndex((model) => model.id === selectedModel)));
  const handleSelect = (modelId: ModelId) => {
    onSelect(modelId);
    onClose();
    requestAnimationFrame(onReturnFocus);
  };

  return (
    <div id="chat-model-listbox" role="listbox" aria-label="Models" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        onReturnFocus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
        const index = options.indexOf(document.activeElement as HTMLElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (index + delta + options.length) % options.length;
        setActiveIndex(nextIndex);
        options[nextIndex]?.focus();
      }
    }} className={`absolute right-[-3.5rem] z-50 w-[320px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-white/[0.13] bg-[#262626] shadow-[0_16px_40px_rgba(0,0,0,0.35)] md:right-0 ${placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'}`}>
      <div className="border-b border-white/[0.07] px-4 py-2.5 text-xs font-medium text-[#aaa6a2]">Choose a model</div>
      <div className="max-h-[min(21rem,calc(100dvh-5rem))] overflow-y-auto p-1.5">
        {AVAILABLE_MODELS.map((model, index) => {
          const isSelected = selectedModel === model.id;
          
          return (
            <button
              role="option"
              aria-selected={isSelected}
              tabIndex={activeIndex === index ? 0 : -1}
              key={model.id}
              onClick={() => handleSelect(model.id as ModelId)}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors ${
                isSelected
                  ? 'bg-white/[0.08]'
                  : 'hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.04]">
                <Image
                  src={model.logo}
                  alt=""
                  width={18}
                  height={18}
                  className={model.company === 'OpenAI' ? 'invert brightness-0' : ''}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[#f0eeeb]">{model.name}</div>
                <div className="truncate text-xs leading-4 text-[#a9a5a0]">{model.description}</div>
              </div>
              {isSelected && <Check className="h-4 w-4 shrink-0 text-[#e8b775]" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
