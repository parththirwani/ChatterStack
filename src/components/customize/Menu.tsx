'use client';
import React, { useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

interface MenuProps {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: React.ReactNode;
  items: MenuItem[];
  triggerClassName?: string;
  align?: 'start' | 'end';
}

/** A small dropdown menu: button + role=menu, with arrow keys and Escape. */
export default function Menu({ label, trigger, items, triggerClassName, align = 'end' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focused]?.focus();
  }, [open, focused]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setFocused((index) => (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => { event.stopPropagation(); setFocused(0); setOpen((value) => !value); }}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setFocused(0); setOpen(true); } }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={`absolute top-full z-50 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#2a2a2a] py-1 shadow-[0_12px_32px_rgba(0,0,0,0.4)] ${align === 'end' ? 'right-0' : 'left-0'}`}>
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              role="menuitem"
              tabIndex={index === focused ? 0 : -1}
              onClick={(event) => { event.stopPropagation(); setOpen(false); item.onSelect(); }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm focus:bg-white/[0.08] focus:outline-none hover:bg-white/[0.08] ${item.danger ? 'text-red-300' : 'text-[#e5e2de]'}`}
            >
              {item.icon && <span className="flex h-4 w-4 items-center justify-center text-[#aaa6a2]">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
