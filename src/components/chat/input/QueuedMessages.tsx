"use client";
import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Forward, GripVertical, ListOrdered, Paperclip, Pencil, X } from 'lucide-react';
import type { QueuedMessage } from '@/src/store/slices/chat/chatSlice';
import { useAppStore } from '@/src/store/rootStore';

interface QueuedMessagesProps {
  conversationKey: string;
  queue: QueuedMessage[];
  /** A reply is streaming: Steer interrupts it instead of just sending. */
  loading: boolean;
  onSteer: (id: string) => void;
  onEditStart: (id: string) => void;
  /** `content` is undefined when the edit was cancelled. */
  onEditEnd: (id: string, content?: string) => void;
}

interface QueuedRowProps {
  item: QueuedMessage;
  index: number;
  loading: boolean;
  dragging: boolean;
  onSteer: (id: string) => void;
  onEditStart: (id: string) => void;
  onEditEnd: (id: string, content?: string) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropAt: (index: number) => void;
}

const iconButton =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#a9a5a0] transition-colors hover:bg-white/[0.08] hover:text-white';

function QueuedRow({ item, index, loading, dragging, onSteer, onEditStart, onEditEnd, onRemove, onDragStart, onDragEnd, onDropAt }: QueuedRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef(false);
  editingRef.current = editing;

  // A row that goes away mid-edit (collapsed, chat switched) releases its
  // hold, so the queue doesn't wait on an editor nobody can see.
  const onEditEndRef = useRef(onEditEnd);
  onEditEndRef.current = onEditEnd;
  useEffect(() => () => {
    if (editingRef.current) onEditEndRef.current(item.id);
  }, [item.id]);

  useLayoutEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  const finishEditing = (save: boolean) => {
    if (!editing) return;
    setEditing(false);
    onEditEnd(item.id, save && draft !== item.content ? draft : undefined);
  };

  const preview = item.content.trim() || item.attachments.map((file) => file.name).join(', ');

  return (
    <li
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
        onDragStart(item.id);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDropAt(index);
      }}
      className={`group flex min-h-9 items-center gap-1.5 rounded-lg pl-1 pr-1 transition-opacity ${dragging ? 'opacity-40' : ''}`}
    >
      <span aria-hidden="true" className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-[#77736f] active:cursor-grabbing">
        <GripVertical className="h-3.5 w-3.5" strokeWidth={1.8} />
      </span>
      {editing ? (
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          aria-label="Edit queued message"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finishEditing(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              finishEditing(true);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              finishEditing(false);
            }
          }}
          className="min-w-0 flex-1 resize-none rounded-md border border-white/[0.18] bg-[#1d1d1d] px-2 py-1 text-[13px] leading-5 text-[#ecebe8] outline-none focus:border-white/[0.38]"
        />
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-5 text-[#d9d6d2]" title={item.content}>
          {item.attachments.length > 0 && <Paperclip className="h-3 w-3 shrink-0 text-[#a9a5a0]" aria-label={`${item.attachments.length} attached`} />}
          <span className="truncate">{preview}</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          setDraft(item.content);
          setEditing(true);
          onEditStart(item.id);
        }}
        aria-label="Edit queued message"
        title="Edit"
        className={iconButton}
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={() => onSteer(item.id)}
        title={loading ? 'Stop the current reply and send this now' : 'Send this now'}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] text-[#a9a5a0] transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <Forward className="h-3.5 w-3.5" strokeWidth={1.8} />
        {loading ? 'Steer' : 'Send'}
      </button>
      <button type="button" onClick={() => onRemove(item.id)} aria-label="Remove queued message" title="Remove" className={iconButton}>
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </li>
  );
}

/**
 * Messages written while a reply streams. They go out one at a time as each
 * reply finishes; Steer sends one immediately.
 */
const QueuedMessages = memo(function QueuedMessages({ conversationKey, queue, loading, onSteer, onEditStart, onEditEnd }: QueuedMessagesProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (queue.length === 0) return null;

  const store = useAppStore.getState;

  return (
    <section
      aria-label="Queued messages"
      className="mx-4 -mb-3 rounded-t-[14px] border border-b-0 border-white/[0.10] bg-[#212121] px-2 pb-4 pt-1.5"
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-[13px] text-[#a9a5a0] transition-colors hover:text-[#d9d6d2]"
      >
        <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span className="flex-1 text-left">Queued</span>
        <span className="tabular-nums">{queue.length}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} strokeWidth={1.8} />
      </button>
      {!collapsed && (
        <ol className="mt-0.5 max-h-[156px] overflow-y-auto">
          {queue.map((item, index) => (
            <QueuedRow
              key={item.id}
              item={item}
              index={index}
              loading={loading}
              dragging={draggingId === item.id}
              onSteer={onSteer}
              onEditStart={onEditStart}
              onEditEnd={onEditEnd}
              onRemove={(id) => store().removeQueuedMessage(conversationKey, id)}
              onDragStart={setDraggingId}
              onDragEnd={() => setDraggingId(null)}
              onDropAt={(to) => {
                if (draggingId) store().moveQueuedMessage(conversationKey, draggingId, to);
                setDraggingId(null);
              }}
            />
          ))}
        </ol>
      )}
    </section>
  );
});

export default QueuedMessages;
