"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { AVAILABLE_MODELS, type ModelId } from '@/src/context/ModelSelectionContext';

interface ModelDropdownProps {
  selectedModel: ModelId;
  onSelect: (modelId: ModelId) => void;
  onClose: () => void;
  onReturnFocus: () => void;
}

export const ModelDropdown: React.FC<ModelDropdownProps> = ({
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
    }} className="fixed inset-x-4 bottom-4 z-50 overflow-hidden rounded-xl border border-white/15 bg-[#282828] shadow-2xl md:absolute md:bottom-full md:left-0 md:right-auto md:mb-3 md:w-[19rem]">
      <div className="max-h-[min(28rem,calc(100dvh-5rem))] overflow-y-auto p-2">
        {AVAILABLE_MODELS.map((model, index) => {
          const isSelected = selectedModel === model.id;
          
          return (
            <button
              role="option"
              aria-selected={isSelected}
              tabIndex={activeIndex === index ? 0 : -1}
              key={model.id}
              onClick={() => handleSelect(model.id as ModelId)}
              className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-white/[0.09] border border-white/10'
                : 'md:hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                <Image
                  src={model.logo}
                  alt=""
                  width={20}
                  height={20}
                  className={model.company === 'OpenAI' ? 'invert brightness-0' : ''}
                />
              </div>
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-white">
                    {model.name}
                  </div>
                </div>
                <div className="mt-0.5 text-[13px] leading-5 text-[#b8b3ad]">
                  {model.description}
                </div>
              </div>
              {isSelected && (
                <div className="flex-shrink-0">
                  <div className="h-2 w-2 rounded-full bg-[#e8b775]"></div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
