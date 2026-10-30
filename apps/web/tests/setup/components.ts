import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom has no canvas. Render the orb as a span that keeps the props the UI
// relies on, so tests can assert which animation state is shown.
vi.mock('thinking-orbs', () => ({
  ThinkingOrb: ({ state, size }: { state?: string; size?: number }) =>
    React.createElement('span', { 'data-testid': 'orb', 'data-state': state ?? 'working', 'data-size': size }),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement('img', { src, alt }),
}));

// jsdom doesn't implement layout; give every element a plausible box so
// placement code has numbers to work with. Tests override per case.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as MediaQueryList;
}

// motion's useInView needs an IntersectionObserver; the stub never fires, so
// arc components stay in their pre-reveal state and tests assert ARIA, not style.
if (!('IntersectionObserver' in globalThis)) {
  class StubIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).IntersectionObserver = StubIntersectionObserver;
}
