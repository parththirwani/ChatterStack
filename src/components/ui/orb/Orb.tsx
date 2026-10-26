"use client";
import React from 'react';
import { ThinkingOrb } from 'thinking-orbs';

interface OrbProps {
  /** composing = a model writing or the council as a whole; searching = one model working on its own. */
  state?: 'composing' | 'searching';
  size?: 20 | 32;
  className?: string;
}

// Decorative: every orb sits next to a text label that carries the status.
export const Orb: React.FC<OrbProps> = ({ state = 'composing', size = 20, className }) => (
  <ThinkingOrb state={state} size={size} theme="dark" aria-hidden="true" className={`shrink-0 ${className ?? ''}`} />
);
