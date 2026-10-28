"use client";
import React, { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import { ModelDropdown } from './ModelDropDown';
import { usePopover } from './usePopover';

// Memoized: the composer re-renders on every keystroke.
export const ModelSelector = memo(function ModelSelector() {
  const { isOpen, placement, close, returnFocus, triggerProps, rootProps } = usePopover('input[type="search"]');
  const { selectedModel, getModelInfo, councilMode } = useModelSelection();
  const label = councilMode ? 'Members' : getModelInfo(selectedModel)?.name || 'Select model';

  return (
    <div {...rootProps} className="relative min-w-0">
      <button
        type="button"
        {...triggerProps}
        aria-label={councilMode ? 'Council settings' : `Model: ${label}`}
        aria-haspopup="dialog"
        aria-controls="chat-model-menu"
        className="flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-[#cfcbc5] transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <span className="min-w-0 truncate font-medium">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-[#aaa6a2] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && <ModelDropdown placement={placement} onClose={close} onReturnFocus={returnFocus} />}
    </div>
  );
});
