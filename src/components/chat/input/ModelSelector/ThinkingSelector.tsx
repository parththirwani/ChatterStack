"use client";
import React, { useState, memo } from 'react';
import { Brain, Check, ChevronDown } from 'lucide-react';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import {
  THINKING_LEVELS,
  THINKING_LEVEL_HINTS,
  THINKING_LEVEL_LABELS,
  closestThinkingLevel,
  effectiveThinkingLevel,
  getThinkingLevels,
  modelSupportsReasoning,
  type ThinkingLevel,
} from '@/src/config/models';
import { usePopover } from './usePopover';

interface ThinkingMenuProps {
  placement: 'down' | 'up';
  levels: readonly ThinkingLevel[];
  note?: string;
  value: ThinkingLevel;
  onSelect: (level: ThinkingLevel) => void;
  onClose: () => void;
  onReturnFocus: () => void;
}

const ThinkingMenu: React.FC<ThinkingMenuProps> = ({ placement, levels, note, value, onSelect, onClose, onReturnFocus }) => {
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, levels.indexOf(value)));

  const closeAndReturn = () => {
    onClose();
    requestAnimationFrame(onReturnFocus);
  };

  return (
    <div
      data-popover-menu
      className={`animate-menu-in absolute right-0 z-50 w-[248px] max-w-[calc(100vw-3rem)] overflow-y-auto rounded-[14px] border border-white/[0.11] bg-[#242424] shadow-[0_18px_44px_rgba(0,0,0,0.42)] ${placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'}`}
    >
      <div id="thinking-menu-label" className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55">Thinking</div>
      <div
        id="thinking-menu"
        role="listbox"
        aria-labelledby="thinking-menu-label"
        className="p-1"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeAndReturn();
            return;
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
          const nextIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
          setActiveIndex(nextIndex);
          options[nextIndex]?.focus();
        }}
      >
        {levels.map((level, index) => {
          const isSelected = level === value;
          return (
            <button
              key={level}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={activeIndex === index ? 0 : -1}
              onClick={() => {
                onSelect(level);
                closeAndReturn();
              }}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isSelected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.045]'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#f0eeeb]">{THINKING_LEVEL_LABELS[level]}</div>
                <div className="text-[12px] leading-[17px] text-[#a9a5a0]">{THINKING_LEVEL_HINTS[level]}</div>
              </div>
              {isSelected && <Check className="h-4 w-4 shrink-0 text-[#e6e3de]" strokeWidth={2.2} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {note && <p className="border-t border-white/[0.08] px-3 py-2.5 text-[12px] leading-[17px] text-[#a9a5a0]">{note}</p>}
    </div>
  );
};

// Memoized: the composer re-renders on every keystroke.
export const ThinkingSelector = memo(function ThinkingSelector() {
  const { isOpen, placement, close, returnFocus, triggerProps, rootProps } = usePopover('[role="option"][aria-selected="true"]');
  const { thinkingLevel, setThinkingLevel, councilMode, councilMembers, selectedModel, getModelInfo } = useModelSelection();
  const models = councilMode ? councilMembers : [selectedModel];
  const supported = models.some(modelSupportsReasoning);
  // In council mode offer every level any member supports; each member then
  // runs at its own closest level.
  const levels = THINKING_LEVELS.filter((level) => models.some((id) => getThinkingLevels(id).includes(level)));
  const shown = closestThinkingLevel(levels, thinkingLevel);
  const label = supported ? THINKING_LEVEL_LABELS[shown] : 'Off';
  const adjusted = councilMode
    ? councilMembers.filter((id) => effectiveThinkingLevel(id, shown) !== shown)
    : [];
  const note = adjusted.length
    ? `${adjusted.map((id) => `${getModelInfo(id)?.name ?? id} uses ${THINKING_LEVEL_LABELS[effectiveThinkingLevel(id, shown)]}`).join('. ')}.`
    : undefined;
  const unsupportedReason = councilMode
    ? 'These models don’t support adjustable thinking'
    : `${getModelInfo(selectedModel)?.name ?? 'This model'} doesn’t support adjustable thinking`;

  return (
    <div {...rootProps} className="relative shrink-0">
      <button
        type="button"
        {...triggerProps}
        disabled={!supported}
        title={supported ? undefined : unsupportedReason}
        aria-label={`Thinking: ${label}${supported ? '' : `. ${unsupportedReason}`}`}
        aria-haspopup="listbox"
        aria-controls="thinking-menu"
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-[#cfcbc5] transition-colors enabled:hover:bg-white/[0.06] enabled:hover:text-white disabled:cursor-not-allowed disabled:text-white/40"
      >
        <Brain className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
        <span className="font-medium">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-[#aaa6a2] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && supported && (
        <ThinkingMenu placement={placement} levels={levels} note={note} value={shown} onSelect={setThinkingLevel} onClose={close} onReturnFocus={returnFocus} />
      )}
    </div>
  );
});
