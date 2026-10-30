"use client";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;
const MIN_SCROLLABLE_HEIGHT = 240;

/**
 * Open/close state for a composer menu. The menu (marked with
 * `data-popover-menu`) opens below its trigger, scrolling if it's taller than
 * the space there, and only flips above when the room below is too small to use. Closes on
 * outside press and focuses `focusSelector` on open.
 */
export function usePopover(focusSelector: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [isOpen]);

  // Runs before paint, so a flip never flashes the menu in the wrong spot.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const menu = rootRef.current?.querySelector<HTMLElement>('[data-popover-menu]');
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (menu && trigger) {
      const needed = menu.offsetHeight + MENU_GAP + VIEWPORT_MARGIN;
      const below = window.innerHeight - trigger.bottom;
      const above = trigger.top;
      // Prefer opening below, scrolling inside the menu if it's a bit tall;
      // only flip up when there's barely any room below (composer at the
      // bottom of a conversation).
      const down = needed <= below || below >= MIN_SCROLLABLE_HEIGHT || below >= above;
      menu.style.maxHeight = `${Math.max(160, (down ? below : above) - MENU_GAP - VIEWPORT_MARGIN)}px`;
      setPlacement(down ? 'down' : 'up');
    }
    rootRef.current?.querySelector<HTMLElement>(focusSelector)?.focus();
  }, [isOpen, focusSelector]);

  const open = () => {
    setPlacement('down');
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);
  const returnFocus = () => triggerRef.current?.focus();

  const triggerProps = {
    ref: triggerRef,
    'aria-expanded': isOpen,
    onClick: () => (isOpen ? close() : open()),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open();
      }
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        close();
      }
    },
  };

  const rootProps = {
    ref: rootRef,
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    },
  };

  return { isOpen, placement, close, returnFocus, triggerProps, rootProps };
}
