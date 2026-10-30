import { describe, expect, it } from 'vitest';
import { attachmentParts, messageContent, validateAttachment } from '@/src/lib/api/chat/attachments';
import type { ChatAttachment } from '@/src/types/chat.types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = (name: string, mimeType: string, value: string): ChatAttachment => ({
  name, mimeType, size: Buffer.byteLength(value), data: Buffer.from(value).toString('base64'),
});

describe('chat attachments', () => {
  it('sends images and PDFs as OpenRouter parts and extracts text files', async () => {
    const image = file('picture.gif', 'image/gif', 'GIF89aanything');
    const pdf = file('report.pdf', 'application/pdf', '%PDF-1.7\nanything');
    const text = file('notes.md', 'text/markdown', '# Notes');
    const parts = await attachmentParts([image, pdf, text]);
    expect(parts).toEqual([
      { type: 'image_url', image_url: { url: `data:image/gif;base64,${image.data}` } },
      { type: 'file', file: { filename: 'report.pdf', file_data: `data:application/pdf;base64,${pdf.data}` } },
      { type: 'text', text: 'File: notes.md\n\n# Notes' },
    ]);
    expect(messageContent('Summarize', parts)).toEqual([{ type: 'text', text: 'Summarize' }, ...parts]);
  });

  it('checks extension, declared size, and file signature', () => {
    expect(() => validateAttachment(file('bad.exe', 'text/plain', 'hello'))).toThrow('Unsupported');
    expect(() => validateAttachment({ ...file('bad.pdf', 'application/pdf', 'wrong') })).toThrow('Invalid PDF');
    expect(() => validateAttachment({ ...file('notes.txt', 'text/plain', 'hello'), size: 9 })).toThrow('Invalid file');
  });

  it('extracts text from a DOCX document', async () => {
    const bytes = readFileSync(resolve('tests/fixtures/attachment.docx'));
    const parts = await attachmentParts([{
      name: 'attachment.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: bytes.length, data: bytes.toString('base64'),
    }]);
    expect(parts).toEqual([{ type: 'text', text: 'File: attachment.docx\n\nProject notes\n\n' }]);
  });
});
