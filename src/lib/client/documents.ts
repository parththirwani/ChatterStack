import { upload } from '@vercel/blob/client';
import type { DocumentAttachment } from '@/src/types/chat.types';

export const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown',
};

async function jsonResponse(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Document request failed');
  return body;
}

export async function uploadDocument(file: File, userId: string): Promise<DocumentAttachment> {
  const mimeType = MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!mimeType || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Unsupported file or size');
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const checked = await jsonResponse(await fetch('/api/documents/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha256 }),
  }));
  if (checked.document) {
    const { id, name, mimeType: type, size } = checked.document;
    return { documentId: id, name, mimeType: type, size };
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  const storageKey = `users/${userId}/${crypto.randomUUID()}/${safeName}`;
  const blob = await upload(storageKey, file, {
    access: 'private', handleUploadUrl: '/api/documents/upload', contentType: mimeType,
  });
  const saved = await jsonResponse(await fetch('/api/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, mimeType, size: file.size, sha256, storageKey: blob.pathname }),
  }));
  const { id, name, mimeType: type, size } = saved.document;
  window.dispatchEvent(new Event('chatterstack:documents-changed'));
  return { documentId: id, name, mimeType: type, size };
}
