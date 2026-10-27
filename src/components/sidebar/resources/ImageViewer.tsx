'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const STEP = 1.25;

const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

interface View {
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

// Wheel zoom answers almost at once; buttons, keys and double-click glide.
const WHEEL_MS = 70;
const GLIDE_MS = 150;

/** Pixels of wheel travel. Firefox reports mouse wheels in lines, not pixels. */
function wheelPixels(event: WheelEvent) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  return Math.max(-240, Math.min(240, event.deltaY * unit));
}

/**
 * Image preview with zoom: buttons, +/-/0 keys, wheel and double-click.
 * 100% is the fitted size. Zoom keeps the point under the cursor in place,
 * and a zoomed image can be dragged to pan.
 */
export default function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [view, setView] = useState<View>(FIT);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [glideMs, setGlideMs] = useState(GLIDE_MS);

  // `focal` is the zoom centre relative to the frame's centre; the view
  // offset moves so that point stays under the cursor.
  const zoomTo = useCallback((next: (scale: number) => number, focal = { x: 0, y: 0 }, ms = GLIDE_MS) => {
    setGlideMs(ms);
    setView((current) => {
      const scale = clamp(next(current.scale));
      if (scale === current.scale) return current;
      if (scale <= 1) return { scale, x: 0, y: 0 };
      const ratio = scale / current.scale;
      return { scale, x: focal.x - (focal.x - current.x) * ratio, y: focal.y - (focal.y - current.y) * ratio };
    });
  }, []);

  const fit = useCallback(() => {
    setGlideMs(GLIDE_MS);
    setView(FIT);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') zoomTo((scale) => scale * STEP);
      else if (event.key === '-' || event.key === '_') zoomTo((scale) => scale / STEP);
      else if (event.key === '0') fit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomTo, fit]);

  // React registers wheel listeners as passive, which cannot stop the modal
  // behind from scrolling, so this one is attached by hand.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const focal = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      // A touchpad pinch arrives as ctrl+wheel in many tiny steps.
      const sensitivity = event.ctrlKey ? 0.01 : 0.002;
      zoomTo((scale) => scale * Math.exp(-wheelPixels(event) * sensitivity), focal, WHEEL_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  const percent = Math.round(view.scale * 100);
  const zoomed = view.scale > 1;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!zoomed || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setView((current) => ({ ...current, x: start.originX + event.clientX - start.startX, y: start.originY + event.clientY - start.startY }));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const focal = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
    if (zoomed) fit();
    else zoomTo(() => 2, focal);
  };

  const button = 'flex h-8 w-8 items-center justify-center rounded-lg text-[#d8d5d1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent';

  return (
    <div className="relative h-full w-full">
      <div
        ref={frame}
        data-testid="image-viewer-frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        className={`flex h-full w-full touch-none select-none items-center justify-center overflow-hidden ${zoomed ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
      >
        {/* Blob URLs are already local and do not need image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: dragging ? 'none' : `transform ${glideMs}ms ease-out`,
          }}
          className="max-h-full max-w-full object-contain will-change-transform"
        />
      </div>
      <div role="toolbar" aria-label="Zoom" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/15 bg-[#161616]/90 p-1 shadow-lg backdrop-blur">
        <button type="button" onClick={() => zoomTo((scale) => scale / STEP)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out" title="Zoom out (−)" className={button}><Minus className="h-4 w-4" /></button>
        <span aria-live="polite" aria-label={`Zoom ${percent}%`} className="min-w-[3.25rem] text-center text-xs tabular-nums text-[#d8d5d1]">{percent}%</span>
        <button type="button" onClick={() => zoomTo((scale) => scale * STEP)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in" title="Zoom in (+)" className={button}><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={fit} disabled={view.scale === 1 && view.x === 0 && view.y === 0} aria-label="Fit to window" title="Fit to window (0)" className={button}><Maximize2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
