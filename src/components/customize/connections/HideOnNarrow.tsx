'use client';
import React from 'react';

/**
 * Words that only earn their horizontal room on a wider screen. Below 400px the
 * sentence leaves the visual layout but stays in the accessibility tree, so a
 * narrow phone keeps the icon or the number it can fit while a screen reader
 * still hears the word - never a mystery glyph, never a lost label.
 */
export function HideOnNarrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`sr-only min-[400px]:not-sr-only ${className}`.trim()}>{children}</span>;
}

export default HideOnNarrow;
