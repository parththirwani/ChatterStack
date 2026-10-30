'use client';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Stays in the menu, but does nothing while its request is in flight. */
  disabled?: boolean;
}

interface MenuProps {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: React.ReactNode;
  items: MenuItem[];
  triggerClassName?: string;
  align?: 'start' | 'end';
  /** Keeps the menu closed (e.g. while one of its actions is still running). */
  disabled?: boolean;
  /** Render above scroll containers and flip near the viewport edge. */
  portal?: boolean;
}

/** A small dropdown menu: button + role=menu, with arrow keys and Escape. */
export default function Menu({ label, trigger, items, triggerClassName, align = 'end', disabled = false, portal = false }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const [position, setPosition] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    if (!open || !portal || !buttonRef.current || !menuRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const top = anchor.bottom + 4 + menu.height <= window.innerHeight - 8
      ? anchor.bottom + 4
      : Math.max(8, anchor.top - menu.height - 4);
    const requestedLeft = align === 'end' ? anchor.right - menu.width : anchor.left;
    setPosition({ top, left: Math.max(8, Math.min(requestedLeft, window.innerWidth - menu.width - 8)) });
  }, [open, portal, align]);

  // A trigger disabled mid-flight must not leave an open menu behind.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focused]?.focus();
  }, [open, focused]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open || !portal) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, portal]);

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

  const dropdown = open && (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      style={portal ? position : undefined}
      className={`${portal ? 'fixed z-[100]' : 'absolute top-full z-50 mt-1'} min-w-[190px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#2a2a2a] py-1 shadow-[0_12px_32px_rgba(0,0,0,0.4)] ${portal ? '' : align === 'end' ? 'right-0' : 'left-0'}`}
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          ref={(node) => { itemRefs.current[index] = node; }}
          type="button"
          role="menuitem"
          tabIndex={index === focused ? 0 : -1}
          aria-disabled={item.disabled || undefined}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
            if (item.disabled) return;
            item.onSelect();
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm focus:bg-white/[0.08] focus:outline-none hover:bg-white/[0.08] ${item.danger ? 'text-red-300' : 'text-[#e5e2de]'} ${item.disabled ? 'cursor-default opacity-50 hover:bg-transparent' : ''}`}
        >
          {item.icon && <span className="flex h-4 w-4 items-center justify-center text-[#aaa6a2]">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={disabled ? false : open}
        aria-disabled={disabled || undefined}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (disabled) return;
          setFocused(0);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open && !disabled) { event.preventDefault(); setFocused(0); setOpen(true); } }}
        className={`${triggerClassName ?? ''}${disabled ? ' opacity-50' : ''}`}
      >
        {trigger}
      </button>
      {portal ? dropdown && createPortal(dropdown, document.body) : dropdown}
    </div>
  );
}
