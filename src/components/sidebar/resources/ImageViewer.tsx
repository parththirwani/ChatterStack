'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hand, Maximize2, Minus, Plus, ZoomIn } from 'lucide-react';

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const STEP = 1.25;
const CLICK_ZOOM = 2;
/** Pointer travel under this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 5;
/** Leaves a little air around a region that is zoomed to. */
const REGION_FILL = 0.96;

const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };

// Wheel zoom answers almost at once; buttons, keys and clicks glide.
const WHEEL_MS = 70;
const GLIDE_MS = 150;

/** Pixels of wheel travel. Firefox reports mouse wheels in lines, not pixels. */
function wheelPixels(event: WheelEvent) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  return Math.max(-240, Math.min(240, event.deltaY * unit));
}

/**
 * Zooms about `focal` (relative to the frame's centre) so that point stays
 * where it is on screen.
 */
export function zoomAbout(view: View, nextScale: number, focal: { x: number; y: number }): View {
  const scale = clamp(nextScale);
  if (scale === view.scale) return view;
  if (scale <= 1) return { scale, x: 0, y: 0 };
  const ratio = scale / view.scale;
  return { scale, x: focal.x - (focal.x - view.x) * ratio, y: focal.y - (focal.y - view.y) * ratio };
}

/**
 * The view that fills the frame with `region` (frame pixels, from its
 * top-left corner), centred.
 */
export function viewForRegion(view: View, frame: { width: number; height: number }, region: Region): View {
  const scale = clamp(view.scale * Math.min(frame.width / region.width, frame.height / region.height) * REGION_FILL);
  if (scale <= 1) return FIT;
  const ratio = scale / view.scale;
  const centre = { x: region.x + region.width / 2 - frame.width / 2, y: region.y + region.height / 2 - frame.height / 2 };
  return { scale, x: (view.x - centre.x) * ratio, y: (view.y - centre.y) * ratio };
}

type Tool = 'magnify' | 'pan';

interface Gesture {
  pointerId: number;
  /** Frame-local start of the gesture. */
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

/**
 * Image preview with zoom. The magnifier tool zooms where you click, or to a
 * box you drag around a region; the hand tool pans a zoomed image. The wheel,
 * +/-/0 keys, toolbar and (hand tool) double-click work too. 100% is the
 * fitted size.
 */
export default function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [view, setView] = useState<View>(FIT);
  const [tool, setTool] = useState<Tool>('magnify');
  const [glideMs, setGlideMs] = useState(GLIDE_MS);
  const [box, setBox] = useState<Region | null>(null);
  const [panning, setPanning] = useState(false);
  const [zoomOutKey, setZoomOutKey] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const apply = useCallback((next: (view: View) => View, ms = GLIDE_MS) => {
    setGlideMs(ms);
    setView(next);
  }, []);
  // `focal` is the zoom centre relative to the frame's centre.
  const zoomTo = useCallback((next: (scale: number) => number, focal = { x: 0, y: 0 }, ms = GLIDE_MS) => {
    apply((current) => zoomAbout(current, next(current.scale), focal), ms);
  }, [apply]);
  const fit = useCallback(() => apply(() => FIT), [apply]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setZoomOutKey(true);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') zoomTo((scale) => scale * STEP);
      else if (event.key === '-' || event.key === '_') zoomTo((scale) => scale / STEP);
      else if (event.key === '0') fit();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setZoomOutKey(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
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

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = frame.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0), width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };
  const toFocal = (point: { x: number; y: number; width: number; height: number }) => ({ x: point.x - point.width / 2, y: point.y - point.height / 2 });

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (tool === 'pan' && !zoomed)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = local(event);
    gesture.current = { pointerId: event.pointerId, startX: point.x, startY: point.y, originX: view.x, originY: view.y, moved: false };
    if (tool === 'pan') setPanning(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const point = local(event);
    const dx = point.x - start.startX;
    const dy = point.y - start.startY;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    start.moved = true;
    if (tool === 'pan') {
      apply((current) => ({ ...current, x: start.originX + dx, y: start.originY + dy }), 0);
    } else {
      setBox({ x: Math.min(start.startX, point.x), y: Math.min(start.startY, point.y), width: Math.abs(dx), height: Math.abs(dy) });
    }
  };
  const endGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPanning(false);
    setBox(null);
    if (tool !== 'magnify' || cancelled) return;
    const point = local(event);
    if (start.moved) {
      const region = { x: Math.min(start.startX, point.x), y: Math.min(start.startY, point.y), width: Math.abs(point.x - start.startX), height: Math.abs(point.y - start.startY) };
      apply((current) => viewForRegion(current, point, region));
    } else if (event.altKey) {
      zoomTo((scale) => scale / CLICK_ZOOM, toFocal(point));
    } else {
      zoomTo((scale) => scale * CLICK_ZOOM, toFocal(point));
    }
  };
  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // With the magnifier a click already zooms, so double-click is for the hand.
    if (tool !== 'pan') return;
    if (zoomed) fit();
    else zoomTo(() => 2, toFocal(local(event)));
  };

  const cursor = tool === 'pan'
    ? (zoomed ? (panning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default')
    : (zoomOutKey ? 'cursor-zoom-out' : 'cursor-zoom-in');
  const button = 'flex h-8 w-8 items-center justify-center rounded-lg text-[#d8d5d1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent';
  const toolButton = (active: boolean) => `${button} ${active ? 'bg-white/15 text-white' : ''}`;

  return (
    <div className="relative h-full w-full">
      <div
        ref={frame}
        data-testid="image-viewer-frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endGesture(event)}
        onPointerCancel={(event) => endGesture(event, true)}
        onDoubleClick={onDoubleClick}
        className={`flex h-full w-full touch-none select-none items-center justify-center overflow-hidden ${cursor}`}
      >
        {/* Blob URLs are already local and do not need image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: glideMs === 0 ? 'none' : `transform ${glideMs}ms ease-out`,
          }}
          className="max-h-full max-w-full object-contain will-change-transform"
        />
      </div>
      {box && <div
        data-testid="zoom-region"
        aria-hidden="true"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        className="pointer-events-none absolute rounded-sm border border-white/90 bg-white/10"
      />}
      <div role="toolbar" aria-label="Zoom" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/15 bg-[#161616]/90 p-1 shadow-lg backdrop-blur">
        <button type="button" onClick={() => setTool('magnify')} aria-pressed={tool === 'magnify'} aria-label="Magnifier" title="Magnifier: click to zoom in, drag to zoom to a region, Alt-click to zoom out" className={toolButton(tool === 'magnify')}><ZoomIn className="h-4 w-4" /></button>
        <button type="button" onClick={() => setTool('pan')} aria-pressed={tool === 'pan'} aria-label="Pan" title="Pan: drag a zoomed image" className={toolButton(tool === 'pan')}><Hand className="h-4 w-4" /></button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" onClick={() => zoomTo((scale) => scale / STEP)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out" title="Zoom out (−)" className={button}><Minus className="h-4 w-4" /></button>
        <span aria-live="polite" aria-label={`Zoom ${percent}%`} className="min-w-[3.25rem] text-center text-xs tabular-nums text-[#d8d5d1]">{percent}%</span>
        <button type="button" onClick={() => zoomTo((scale) => scale * STEP)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in" title="Zoom in (+)" className={button}><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={fit} disabled={view.scale === 1 && view.x === 0 && view.y === 0} aria-label="Fit to window" title="Fit to window (0)" className={button}><Maximize2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
