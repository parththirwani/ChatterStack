import crypto from 'node:crypto';
import { prisma } from '@/src/lib/prisma';
import { documentStorage } from './document-storage';
import { fileMimeType, validateAttachment } from '@/src/lib/api/chat/attachments';
import type { ChatAttachment, DocumentAttachment } from '@/src/types/chat.types';
import type { Prisma } from '@prisma/client';

export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;
export const RETENTION_DAYS = 30;

export function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

export function newStorageKey(userId: string, name: string) {
  return `users/${userId}/${crypto.randomUUID()}/${safeFileName(name)}`;
}

export function validStorageKey(userId: string, key: string) {
  return key.startsWith(`users/${userId}/`) &&
    /^users\/[^/]+\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]{1,180}$/.test(key);
}

export function documentMeta(document: {
  id: string; name: string; mimeType: string; size: number; sha256: string;
  favoritedAt: Date | null; lastUsedAt: Date | null; createdAt: Date;
}) {
  return {
    id: document.id, name: document.name, mimeType: document.mimeType, size: document.size,
    sha256: document.sha256, favoritedAt: document.favoritedAt?.toISOString() ?? null,
    lastUsedAt: document.lastUsedAt?.toISOString() ?? null, createdAt: document.createdAt.toISOString(),
  };
}

export async function confirmUpload(userId: string, input: {
  name: string; mimeType: string; size: number; sha256: string; storageKey: string;
}) {
  if (!validStorageKey(userId, input.storageKey) || !fileMimeType(input.name) ||
    fileMimeType(input.name) !== input.mimeType || input.size < 1 || input.size > MAX_FILE_SIZE ||
    !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Invalid file details');
  const existing = await prisma.document.findUnique({ where: { userId_sha256: { userId, sha256: input.sha256 } } });
  if (existing) {
    if (existing.storageKey !== input.storageKey) await documentStorage.delete(input.storageKey);
    return existing;
  }
  const stat = await documentStorage.stat(input.storageKey);
  if (stat.size !== input.size || stat.contentType !== input.mimeType) throw new Error('Uploaded file does not match');
  const bytes = await documentStorage.read(input.storageKey);
  if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== input.sha256) throw new Error('Uploaded file does not match');
  validateAttachment({ name: input.name, mimeType: input.mimeType, size: input.size, data: bytes.toString('base64') });
  try {
    return await prisma.document.create({ data: { ...input, userId } });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const duplicate = await prisma.document.findUnique({ where: { userId_sha256: { userId, sha256: input.sha256 } } });
    if (!duplicate) throw error;
    await documentStorage.delete(input.storageKey);
    return duplicate;
  }
}

export async function resolveDocuments(userId: string, files: DocumentAttachment[], missingAsNote = false): Promise<ChatAttachment[]> {
  const ids = files.map((file) => file.documentId);
  const documents = await prisma.document.findMany({ where: { id: { in: ids }, userId } });
  const byId = new Map(documents.map((document) => [document.id, document]));
  const resolved: ChatAttachment[] = [];
  for (const file of files) {
    const document = byId.get(file.documentId);
    if (!document) {
      if (missingAsNote) continue;
      throw new Error('Document not found');
    }
    const bytes = await documentStorage.read(document.storageKey);
    if (!bytes) {
      if (missingAsNote) continue;
      throw new Error('Document content is missing');
    }
    resolved.push({ documentId: document.id, name: document.name, mimeType: document.mimeType, size: document.size, data: bytes.toString('base64') });
  }
  return resolved;
}

export async function markDocumentsUsed(userId: string, files: DocumentAttachment[]) {
  if (!files.length) return;
  await prisma.document.updateMany({ where: { userId, id: { in: files.map((file) => file.documentId) } }, data: { lastUsedAt: new Date() } });
}

export async function storeLegacyAttachment(userId: string, file: ChatAttachment) {
  const bytes = validateAttachment(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const existing = await prisma.document.findUnique({ where: { userId_sha256: { userId, sha256 } } });
  if (existing) return existing;
  const storageKey = newStorageKey(userId, file.name);
  await documentStorage.save(storageKey, bytes, file.mimeType);
  try {
    return await prisma.document.create({ data: { userId, name: file.name, mimeType: file.mimeType, size: file.size, sha256, storageKey, lastUsedAt: new Date() } });
  } catch (error) {
    await documentStorage.delete(storageKey);
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const duplicate = await prisma.document.findUnique({ where: { userId_sha256: { userId, sha256 } } });
    if (!duplicate) throw error;
    return duplicate;
  }
}

export async function removeDocument(userId: string, id: string) {
  const document = await prisma.document.findFirst({ where: { id, userId } });
  if (!document) return false;
  await documentStorage.delete(document.storageKey);
  await prisma.document.delete({ where: { id } });
  return true;
}

export async function cleanupUnusedDocuments(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.document.findMany({
    where: { favoritedAt: null, createdAt: { lt: cutoff }, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }] },
    select: { id: true, userId: true },
    take: 100,
  });
  let removed = 0;
  for (const document of candidates) {
    if (await removeDocument(document.userId, document.id)) removed += 1;
  }
  return removed;
}

export function attachmentReferences(files: DocumentAttachment[]): Prisma.InputJsonValue {
  return files.map(({ documentId, name, mimeType, size }) => ({ documentId, name, mimeType, size }));
}
