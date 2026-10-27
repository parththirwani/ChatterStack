"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, ChevronDown, Search } from 'lucide-react';
import { AVAILABLE_MODELS, useModelSelection, type ModelInfo } from '@/src/context/ModelSelectionContext';
import { COUNCIL_MAX_MEMBERS, COUNCIL_MIN_MEMBERS } from '@/src/config/models';

interface ModelDropdownProps {
  placement: 'down' | 'up';
  onClose: () => void;
  onReturnFocus: () => void;
}

const sectionLabel = 'px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55';

function matchesQuery(model: ModelInfo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${model.name} ${model.company} ${model.description} ${model.id}`.toLowerCase().includes(needle);
}

/** Keep registry order, but collect each company into its own labelled block. */
function groupByCompany(models: readonly ModelInfo[]): Array<[string, ModelInfo[]]> {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const group = groups.get(model.company);
    if (group) group.push(model);
    else groups.set(model.company, [model]);
  }
  return [...groups.entries()];
}

const SearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onArrowDown: () => void;
}> = ({ value, onChange, onArrowDown }) => (
  <div className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#242424] p-2">
    <div className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-2.5">
      <Search className="h-3.5 w-3.5 shrink-0 text-[#aaa6a2]" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            onArrowDown();
          }
        }}
        placeholder="Search models"
        aria-label="Search models"
        autoComplete="off"
        spellCheck={false}
        className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-[#f0eeeb] outline-none placeholder:text-[#8d8984] [&::-webkit-search-cancel-button]:hidden"
      />
    </div>
  </div>
);

const EmptySearch: React.FC = () => (
  <p className="px-3 py-8 text-center text-[12px] text-[#a9a5a0]">No models match that search.</p>
);

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

const ModelGroup: React.FC<{
  company: string;
  models: ModelInfo[];
  renderModel: (model: ModelInfo) => React.ReactNode;
}> = ({ company, models, renderModel }) => (
  <div role="group" aria-label={company}>
    <div className={sectionLabel} aria-hidden="true">{company}</div>
    {models.map(renderModel)}
  </div>
);

const ModelList: React.FC<{ onPicked: () => void }> = ({ onPicked }) => {
  const { selectedModel, setSelectedModel } = useModelSelection();
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => AVAILABLE_MODELS.filter((model) => matchesQuery(model, query)), [query]);
  const groups = useMemo(() => groupByCompany(filtered), [filtered]);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, AVAILABLE_MODELS.findIndex((model) => model.id === selectedModel)));

  useEffect(() => {
    setActiveIndex(Math.max(0, filtered.findIndex((model) => model.id === selectedModel)));
  }, [filtered, selectedModel]);

  return (
    <>
      <SearchField
        value={query}
        onChange={setQuery}
        onArrowDown={() => listRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus()}
      />
      <div
        ref={listRef}
        id="chat-model-label"
        role="listbox"
        aria-label="Model"
        className="p-1"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
          const index = options.indexOf(document.activeElement as HTMLElement);
          const nextIndex = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
          setActiveIndex(nextIndex);
          options[nextIndex]?.focus();
        }}
      >
        {!filtered.length && <EmptySearch />}
        {groups.map(([company, models]) => (
          <ModelGroup
            key={company}
            company={company}
            models={models}
            renderModel={(model) => {
              const isSelected = selectedModel === model.id;
              const index = filtered.indexOf(model);
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
            }}
          />
        ))}
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
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => AVAILABLE_MODELS.filter((model) => matchesQuery(model, query)), [query]);
  const groups = useMemo(() => groupByCompany(filtered), [filtered]);

  useEffect(() => {
    setActiveIndex(filtered.length ? Math.max(0, filtered.findIndex((model) => councilMembers.includes(model.id))) : 0);
  }, [filtered, councilMembers]);

  return (
    <>
      <SearchField
        value={query}
        onChange={setQuery}
        onArrowDown={() => listRef.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus()}
      />
      <div className={`${sectionLabel} flex items-baseline justify-between`}>
        <span id="council-members-label">Council members</span>
        <span className="normal-case tracking-normal text-white/55">
          {councilMembers.length <= COUNCIL_MIN_MEMBERS ? `Minimum ${COUNCIL_MIN_MEMBERS}` : `${councilMembers.length} of ${COUNCIL_MAX_MEMBERS}`}
        </span>
      </div>
      <div
        ref={listRef}
        role="group"
        aria-labelledby="council-members-label"
        className="p-1"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="checkbox"]'));
          const index = options.indexOf(document.activeElement as HTMLElement);
          const nextIndex = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
          setActiveIndex(nextIndex);
          options[nextIndex]?.focus();
        }}
      >
        {!filtered.length && <EmptySearch />}
        {groups.map(([company, models]) => (
          <ModelGroup
            key={company}
            company={company}
            models={models}
            renderModel={(model) => {
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
                  tabIndex={activeIndex === filtered.indexOf(model) ? 0 : -1}
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
            }}
          />
        ))}
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
