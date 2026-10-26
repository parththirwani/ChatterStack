"use client";

import React, { useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, ChevronDown } from 'lucide-react';
import { AVAILABLE_MODELS, useModelSelection, type ModelInfo } from '@/src/context/ModelSelectionContext';
import { COUNCIL_MAX_MEMBERS, COUNCIL_MIN_MEMBERS } from '@/src/config/models';

interface ModelDropdownProps {
  placement: 'down' | 'up';
  onClose: () => void;
  onReturnFocus: () => void;
}

const sectionLabel = 'px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55';

const ModelLogo: React.FC<{ model: ModelInfo }> = ({ model }) => (
  <div className="flex h-5 w-5 shrink-0 items-center justify-center">
    <Image src={model.logo} alt="" width={17} height={17} className={model.company === 'OpenAI' ? 'invert brightness-0' : ''} />
  </div>
);

const ModelText: React.FC<{ model: ModelInfo }> = ({ model }) => (
  <div className="min-w-0 flex-1">
    <div className="truncate text-[13px] font-medium text-[#f0eeeb]">{model.name}</div>
    <div className="truncate text-[12px] leading-[17px] text-[#a9a5a0]">{model.description}</div>
  </div>
);

const ModelList: React.FC<{ onPicked: () => void }> = ({ onPicked }) => {
  const { selectedModel, setSelectedModel } = useModelSelection();
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, AVAILABLE_MODELS.findIndex((model) => model.id === selectedModel)));

  return (
    <>
      <div id="chat-model-label" className={sectionLabel}>Model</div>
      <div role="listbox" aria-labelledby="chat-model-label" className="p-1" onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
        const index = options.indexOf(document.activeElement as HTMLElement);
        const nextIndex = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        setActiveIndex(nextIndex);
        options[nextIndex]?.focus();
      }}>
        {AVAILABLE_MODELS.map((model, index) => {
          const isSelected = selectedModel === model.id;
          return (
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={activeIndex === index ? 0 : -1}
              key={model.id}
              onClick={() => {
                setSelectedModel(model.id);
                onPicked();
              }}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isSelected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.045]'}`}
            >
              <ModelLogo model={model} />
              <ModelText model={model} />
              {isSelected && <Check className="h-4 w-4 shrink-0 text-[#e6e3de]" strokeWidth={2.2} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </>
  );
};

const ChairPicker: React.FC = () => {
  const { councilMembers, councilChair, setCouncilChair, getModelInfo } = useModelSelection();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chair = getModelInfo(councilChair);

  useLayoutEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  const collapse = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="px-1 pb-1">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="council-chair-listbox"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-white/[0.045]"
      >
        <span className="text-[#cfcbc5]">Chair</span>
        <span className="flex-1" />
        {chair && <ModelLogo model={chair} />}
        <span className="truncate font-medium text-[#f0eeeb]">{chair?.name ?? councilChair}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-[#aaa6a2] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={listRef}
          id="council-chair-listbox"
          role="listbox"
          aria-label="Chair"
          className="mx-1 mb-1 rounded-lg border border-white/[0.08] bg-white/[0.025] p-1"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // Close just this list, not the whole menu.
              event.preventDefault();
              event.stopPropagation();
              collapse();
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
            const index = options.indexOf(document.activeElement as HTMLElement);
            options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
          }}
        >
          {councilMembers.map((id) => {
            const model = getModelInfo(id);
            const isSelected = id === councilChair;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => {
                  setCouncilChair(id);
                  collapse();
                }}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-[#f0eeeb] transition-colors ${isSelected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.045]'}`}
              >
                {model && <ModelLogo model={model} />}
                <span className="min-w-0 flex-1 truncate">{model?.name ?? id}</span>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-[#e6e3de]" strokeWidth={2.2} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const CouncilMemberList: React.FC = () => {
  const { councilMembers, toggleCouncilMember } = useModelSelection();

  return (
    <>
      <div className={`${sectionLabel} flex items-baseline justify-between`}>
        <span id="council-members-label">Council members</span>
        <span className="normal-case tracking-normal text-white/55">
          {councilMembers.length <= COUNCIL_MIN_MEMBERS ? `Minimum ${COUNCIL_MIN_MEMBERS}` : `${councilMembers.length} of ${COUNCIL_MAX_MEMBERS}`}
        </span>
      </div>
      <div role="group" aria-labelledby="council-members-label" className="p-1">
        {AVAILABLE_MODELS.map((model) => {
          const checked = councilMembers.includes(model.id);
          const locked = checked ? councilMembers.length <= COUNCIL_MIN_MEMBERS : councilMembers.length >= COUNCIL_MAX_MEMBERS;
          return (
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-disabled={locked || undefined}
              title={locked && checked ? `A council needs at least ${COUNCIL_MIN_MEMBERS} members` : undefined}
              key={model.id}
              onClick={() => !locked && toggleCouncilMember(model.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${locked ? 'cursor-default' : 'cursor-pointer hover:bg-white/[0.045]'}`}
            >
              <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors ${checked ? 'border-[#f0eeeb] bg-[#f0eeeb] text-[#1c1b19]' : 'border-[#6f6b66]'} ${locked ? 'opacity-60' : ''}`}>
                {checked && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <ModelLogo model={model} />
              <ModelText model={model} />
            </button>
          );
        })}
      </div>
      <ChairPicker />
      <p className="mx-3 mb-3 px-0.5 text-[12px] leading-[17px] text-[#a9a5a0]">The chair writes the final answer from everyone’s input.</p>
    </>
  );
};

export const ModelDropdown: React.FC<ModelDropdownProps> = ({ placement, onClose, onReturnFocus }) => {
  const { councilMode } = useModelSelection();

  const closeAndReturn = () => {
    onClose();
    requestAnimationFrame(onReturnFocus);
  };

  return (
    <div
      id="chat-model-menu"
      data-popover-menu
      role="dialog"
      aria-label={councilMode ? 'Council settings' : 'Model settings'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeAndReturn();
        }
      }}
      className={`animate-menu-in absolute right-[-3.5rem] z-50 w-[300px] max-w-[calc(100vw-3rem)] overflow-y-auto rounded-[14px] border border-white/[0.11] bg-[#242424] shadow-[0_18px_44px_rgba(0,0,0,0.42)] md:right-0 ${placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'}`}
    >
      <div>
        {councilMode ? <CouncilMemberList /> : <ModelList onPicked={closeAndReturn} />}
      </div>
    </div>
  );
};
