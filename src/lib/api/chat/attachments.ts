import mammoth from 'mammoth';
import type { ChatAttachment } from '@/src/types/chat.types';

export type OpenRouterPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown',
};

export function fileMimeType(name: string): string | undefined {
  return MIME_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''];
}

export function validateAttachment(file: ChatAttachment): Buffer {
  const mimeType = fileMimeType(file.name);
  if (!mimeType || mimeType !== file.mimeType) throw new Error(`Unsupported file: ${file.name}`);
  const bytes = Buffer.from(file.data, 'base64');
  if (bytes.length !== file.size || bytes.length === 0 || bytes.length > 5 * 1024 * 1024) {
    throw new Error(`Invalid file: ${file.name}`);
  }
  if (mimeType === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(`Invalid PDF: ${file.name}`);
  }
  if (mimeType === 'image/png' && bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${file.name}`);
  if (mimeType === 'image/jpeg' && bytes.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new Error(`Invalid JPEG: ${file.name}`);
  if (mimeType === 'image/gif' && !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) throw new Error(`Invalid GIF: ${file.name}`);
  if (mimeType === 'image/webp' && (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP')) throw new Error(`Invalid WebP: ${file.name}`);
  if (mimeType.endsWith('wordprocessingml.document') && bytes.subarray(0, 2).toString() !== 'PK') throw new Error(`Invalid DOCX: ${file.name}`);
  return bytes;
}

export async function attachmentParts(files: ChatAttachment[]): Promise<OpenRouterPart[]> {
  const parts: OpenRouterPart[] = [];
  let textLength = 0;
  for (const file of files) {
    const bytes = validateAttachment(file);
    if (file.mimeType.startsWith('image/')) {
      parts.push({ type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.data}` } });
    } else if (file.mimeType === 'application/pdf') {
      parts.push({ type: 'file', file: { filename: file.name, file_data: `data:application/pdf;base64,${file.data}` } });
    } else {
      const extracted = file.mimeType.endsWith('wordprocessingml.document')
        ? (await mammoth.extractRawText({ buffer: bytes })).value
        : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      textLength += extracted.length;
      if (textLength > 100_000) throw new Error('Attached text exceeds 100,000 characters');
      parts.push({ type: 'text', text: `File: ${file.name}\n\n${extracted}` });
    }
  }
  return parts;
}

export function messageContent(message: string, parts: OpenRouterPart[]): string | OpenRouterPart[] {
  return parts.length ? [{ type: 'text', text: message || 'Please examine the attached file(s).' }, ...parts] : message;
}
