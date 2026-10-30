import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Resources from '@/src/components/sidebar/resources/Resources';

const document = {
  id: '0e7ba32e-05b0-477d-8e30-2bf0a849649e',
  name: 'plan.md', mimeType: 'text/markdown', size: 2048, sha256: 'a'.repeat(64),
  createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-20T00:00:00.000Z', favoritedAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Resources', () => {
  it('lists files, adds a reference to the active composer, favourites and deletes', async () => {
    const user = userEvent.setup();
    const files = [{ ...document }];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/documents' && !init) return Response.json({ documents: files });
      if (url === `/api/documents/${document.id}/content?preview=1`) return new Response('# Project plan');
      if (url.endsWith(document.id) && init?.method === 'PATCH') {
        files[0].favoritedAt = new Date().toISOString() as never;
        return Response.json({ document: files[0] });
      }
      if (url.endsWith(document.id) && init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetcher);
    const added = vi.fn();
    window.addEventListener('chatterstack:add-document', added);
    try {
      render(<Resources />);
      const previewButton = await screen.findByRole('button', { name: 'Preview plan.md' });
      expect(screen.getByText(/2.0 KB/)).toBeInTheDocument();
      expect(screen.getByText(/Deletes in/)).toBeInTheDocument();
      await user.click(previewButton);
      expect(await screen.findByRole('dialog', { name: 'plan.md' })).toBeInTheDocument();
      expect(await screen.findByText('# Project plan')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Download plan.md' })).toHaveAttribute('href', `/api/documents/${document.id}/content`);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Add plan.md to chat' }));
      expect((added.mock.calls[0][0] as CustomEvent).detail).toEqual({
        documentId: document.id, name: document.name, mimeType: document.mimeType, size: document.size,
      });
      await user.click(screen.getByRole('button', { name: 'Favourite plan.md' }));
      await waitFor(() => expect(screen.getByText(/Kept/)).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Unfavourite plan.md' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Delete plan.md' }));
      expect(screen.queryByRole('button', { name: 'Preview plan.md' })).toBeNull();
      expect(fetcher).toHaveBeenCalledWith(`/api/documents/${document.id}`, expect.objectContaining({ method: 'DELETE' }));
    } finally {
      window.removeEventListener('chatterstack:add-document', added);
    }
  });

  it('shows an empty state and refreshes after a new upload', async () => {
    let files: typeof document[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ documents: files })));
    render(<Resources />);
    expect(await screen.findByText(/Files you attach/)).toBeInTheDocument();
    files = [document];
    window.dispatchEvent(new Event('chatterstack:documents-changed'));
    expect(await screen.findByRole('button', { name: 'Preview plan.md' })).toBeInTheDocument();
  });
});
