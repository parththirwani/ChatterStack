'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, Star, Trash2 } from 'lucide-react';
import type { DocumentAttachment } from '@/src/types/chat.types';
import DocumentPreview from './DocumentPreview';
import { showConversation } from '@/src/lib/navigation';

interface DocumentRow extends DocumentAttachment {
  id: string;
  favoritedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function expiryLabel(document: DocumentRow) {
  if (document.favoritedAt) return 'Kept';
  const last = new Date(document.lastUsedAt ?? document.createdAt).getTime();
  const days = Math.max(0, Math.ceil((last + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)));
  return `Deletes in ${days} day${days === 1 ? '' : 's'}`;
}

export default function Resources() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<DocumentRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/documents');
      if (!response.ok) throw new Error('Could not load resources');
      setDocuments((await response.json()).documents);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load resources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('chatterstack:documents-changed', refresh);
    return () => window.removeEventListener('chatterstack:documents-changed', refresh);
  }, [refresh]);

  const favorite = async (document: DocumentRow) => {
    const response = await fetch(`/api/documents/${document.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !document.favoritedAt }),
    });
    if (!response.ok) { setError('Could not update favourite'); return; }
    await refresh();
  };

  const remove = async (document: DocumentRow) => {
    const response = await fetch(`/api/documents/${document.id}`, { method: 'DELETE' });
    if (!response.ok) { setError('Could not delete document'); return; }
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    if (preview?.id === document.id) setPreview(null);
  };

  const addToChat = (document: DocumentRow) => {
    const added = window.dispatchEvent(new CustomEvent<DocumentAttachment>('chatterstack:add-document', {
      detail: { documentId: document.id, name: document.name, mimeType: document.mimeType, size: document.size },
      cancelable: true,
    }));
    if (!added) {
      setError('This chat already has that file or has reached its attachment limit.');
      return;
    }
    setError('');
    // The composer is waiting in the chat view; go back to it.
    showConversation(undefined);
  };

  return (
    <section aria-label="Resources" className="space-y-2 py-3">
      {loading && <p className="px-3 text-xs text-[#aaa6a2]">Loading resources…</p>}
      {error && <p role="alert" className="px-3 text-xs text-red-300">{error}</p>}
      {!loading && documents.length === 0 && <p className="px-3 text-xs leading-5 text-[#aaa6a2]">Files you attach to chats will appear here.</p>}
      {documents.map((document) => (
        <div key={document.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-[#aaa6a2]" />
            <button type="button" onClick={() => setPreview(document)} className="min-w-0 truncate text-left text-sm text-[#eee] hover:underline" title={document.name} aria-label={`Preview ${document.name}`}>{document.name}</button>
          </div>
          <p className="mt-1 pl-6 text-[11px] text-[#aaa6a2]">{document.name.split('.').at(-1)?.toUpperCase()} · {(document.size / 1024).toFixed(1)} KB · {expiryLabel(document)}</p>
          <div className="mt-2 flex items-center gap-1 pl-5">
            <button type="button" onClick={() => addToChat(document)} aria-label={`Add ${document.name} to chat`} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.08]"><Plus className="h-3 w-3" /> Add to chat</button>
            <button type="button" onClick={() => void favorite(document)} aria-label={`${document.favoritedAt ? 'Unfavourite' : 'Favourite'} ${document.name}`} className="rounded-md p-1.5 text-[#aaa6a2] hover:bg-white/[0.08] hover:text-white"><Star className="h-3.5 w-3.5" fill={document.favoritedAt ? 'currentColor' : 'none'} /></button>
            <button type="button" onClick={() => void remove(document)} aria-label={`Delete ${document.name}`} className="rounded-md p-1.5 text-[#aaa6a2] hover:bg-white/[0.08] hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
      {preview && <DocumentPreview document={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
