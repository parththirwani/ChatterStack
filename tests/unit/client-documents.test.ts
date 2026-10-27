import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.fn();
vi.mock('@vercel/blob/client', () => ({ upload: (...args: unknown[]) => upload(...args) }));

const { uploadDocument } = await import('@/src/lib/client/documents');

const saved = { id: 'doc-1', name: 'cat.png', mimeType: 'image/png', size: 3 };
const attached = { documentId: 'doc-1', name: 'cat.png', mimeType: 'image/png', size: 3 };
const file = new File([new Uint8Array([1, 2, 3])], 'cat.png', { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', { randomUUID: () => 'upload-id', subtle: globalThis.crypto.subtle });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  upload.mockResolvedValue({ pathname: 'users/user-1/upload-id/cat.png' });
});

const stubFetch = (checked: unknown, confirmed = saved) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === '/api/documents/check') return Response.json(checked);
  if (url === '/api/documents') return Response.json({ document: confirmed });
  throw new Error(`unexpected request: ${url}`);
}));

describe('uploadDocument', () => {
  it('reports rising progress while the bytes move, then 1', async () => {
    stubFetch({});
    upload.mockImplementation(async (_key: string, _file: File, options: { onUploadProgress?: (event: { percentage: number }) => void }) => {
      options.onUploadProgress?.({ percentage: 0 });
      options.onUploadProgress?.({ percentage: 50 });
      options.onUploadProgress?.({ percentage: 100 });
      return { pathname: 'users/user-1/upload-id/cat.png' };
    });
    const progress: number[] = [];

    await expect(uploadDocument(file, 'user-1', (fraction) => progress.push(fraction))).resolves.toEqual(attached);

    expect(progress[0]).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith('users/user-1/upload-id/cat.png', file, expect.objectContaining({
      access: 'private', contentType: 'image/png', handleUploadUrl: '/api/documents/upload',
    }));
  });

  it('skips the upload when the user already owns identical content', async () => {
    stubFetch({ document: saved });
    const progress: number[] = [];

    await expect(uploadDocument(file, 'user-1', (fraction) => progress.push(fraction))).resolves.toEqual(attached);

    expect(upload).not.toHaveBeenCalled();
    expect(progress.at(-1)).toBe(1);
  });
});
