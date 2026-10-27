import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageInput from '@/src/components/chat/input/MessageInput';
import UserMessage from '@/src/components/chat/messages/UserMessage/UserMessage';
import { ModelSelectionProvider } from '@/src/context/ModelSelectionContext';
import { resetSkillsCache } from '@/src/lib/client/skills';
import { uploadDocument } from '@/src/lib/client/documents';
import { useAppStore } from '@/src/store/rootStore';
import type { DocumentAttachment } from '@/src/types/chat.types';
import type { User } from '@/src/types/user.types';

vi.mock('@/src/lib/client/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/client/documents')>()),
  uploadDocument: vi.fn(),
}));

const uploadMock = vi.mocked(uploadDocument);
const file = (name: string, type: string, bytes = 3) => new File([new Uint8Array(bytes)], name, { type });

function Composer({ onAttachments }: { onAttachments?: (files: DocumentAttachment[]) => void }) {
  const [message, setMessage] = useState('hello');
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  onAttachments?.(attachments);
  return (
    <ModelSelectionProvider>
      <MessageInput
        message={message}
        onMessageChange={setMessage}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSendMessage={vi.fn()}
        loading={false}
      />
    </ModelSelectionProvider>
  );
}

const chooseFiles = async (user: ReturnType<typeof userEvent.setup>, ...files: File[]) => {
  await user.upload(screen.getByLabelText('Choose files'), files);
};

beforeEach(() => {
  resetSkillsCache();
  uploadMock.mockReset();
  useAppStore.setState({ user: { id: 'user-1', name: 'Ada' } as User });
  vi.stubGlobal('crypto', { randomUUID: () => `pending-${Math.random()}` });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:local-preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/skills') return Response.json({ skills: [] });
    return Response.json({});
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('attachments while uploading', () => {
  it('shows the picked image and a progress state before the upload resolves', async () => {
    const user = userEvent.setup();
    let finish!: (attachment: DocumentAttachment) => void;
    uploadMock.mockImplementation((_file, _userId, onProgress) => {
      onProgress?.(0.42);
      return new Promise((resolve) => { finish = resolve; });
    });

    render(<Composer />);
    await chooseFiles(user, file('cat.png', 'image/png'));

    const tile = await screen.findByRole('listitem', { name: /cat\.png, uploading/ });
    expect(tile).toBeInTheDocument();
    expect(screen.getByAltText('cat.png')).toHaveAttribute('src', 'blob:local-preview');
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText(/Uploading 1 file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    await act(async () => { finish({ documentId: 'doc-1', name: 'cat.png', mimeType: 'image/png', size: 3 }); });

    await waitFor(() => expect(screen.queryByText('42%')).toBeNull());
    // The decoded local preview stays on screen; the saved document backs the tile.
    expect(screen.getByAltText('cat.png')).toHaveAttribute('src', 'blob:local-preview');
    expect(screen.getByRole('button', { name: 'Preview cat.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('sketches a labelled tile for files that have no local preview', async () => {
    const user = userEvent.setup();
    uploadMock.mockImplementation(() => new Promise(() => {}));

    render(<Composer />);
    await chooseFiles(user, file('report.pdf', 'application/pdf'));

    const tile = await screen.findByRole('listitem', { name: /report\.pdf, uploading/ });
    expect(tile).toHaveTextContent('PDF');
    expect(tile).toHaveTextContent('report.pdf');
    // A skeleton, not a blank box, while the first byte is still in flight.
    expect(tile.querySelector('.animate-spin')).not.toBeNull();
  });

  it('keeps a failed upload visible with the reason, so it can be removed', async () => {
    const user = userEvent.setup();
    uploadMock.mockRejectedValue(new Error('Blob store rejected the file'));

    render(<Composer />);
    await chooseFiles(user, file('cat.png', 'image/png'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Blob store rejected the file');
    const tile = screen.getByRole('listitem', { name: /cat\.png, upload failed/ });
    expect(tile).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove cat.png' }));
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeEnabled();
  });
});

describe('attachment bookkeeping', () => {
  it('attaches identical files once', async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ documentId: 'doc-1', name: 'cat.png', mimeType: 'image/png', size: 3 });

    render(<Composer />);
    await chooseFiles(user, file('cat.png', 'image/png'), file('copy.png', 'image/png'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('releases the local preview once its attachment is removed', async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ documentId: 'doc-1', name: 'cat.png', mimeType: 'image/png', size: 3 });

    render(<Composer />);
    await chooseFiles(user, file('cat.png', 'image/png'));
    await user.click(await screen.findByRole('button', { name: 'Remove cat.png' }));

    expect(screen.queryByRole('listitem')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
  });
});

describe('previewing a file that was just uploaded', () => {
  const contentCalls = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/documents/'));

  it('opens from the picked file without downloading it back', async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ documentId: 'doc-1', name: 'notes.txt', mimeType: 'text/plain', size: 11 });

    render(<Composer />);
    await chooseFiles(user, new File(['local notes'], 'notes.txt', { type: 'text/plain' }));
    await user.click(await screen.findByRole('button', { name: 'Preview notes.txt' }));

    expect(await screen.findByText('local notes')).toBeInTheDocument();
    expect(contentCalls()).toHaveLength(0);
  });

  it('still asks the server for DOCX text, which only it can extract', async () => {
    const user = userEvent.setup();
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    uploadMock.mockResolvedValue({ documentId: 'doc-2', name: 'plan.docx', mimeType: docx, size: 4 });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/documents/')) return new Response('extracted text');
      return Response.json(String(input) === '/api/skills' ? { skills: [] } : {});
    }));

    render(<Composer />);
    await chooseFiles(user, new File(['PK'], 'plan.docx', { type: docx }));
    await user.click(await screen.findByRole('button', { name: 'Preview plan.docx' }));

    expect(await screen.findByText('extracted text')).toBeInTheDocument();
    expect(contentCalls().map(([input]) => String(input))).toEqual(['/api/documents/doc-2/content?preview=1']);
  });
});

describe('zooming an image preview', () => {
  const openImage = async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ documentId: 'doc-1', name: 'cat.png', mimeType: 'image/png', size: 3 });
    render(<Composer />);
    await chooseFiles(user, file('cat.png', 'image/png'));
    await user.click(await screen.findByRole('button', { name: 'Preview cat.png' }));
    await screen.findByRole('toolbar', { name: 'Zoom' });
    return user;
  };

  it('zooms in and out from the toolbar and fits back to the window', async () => {
    const user = await openImage();
    const image = screen.getAllByAltText('cat.png').at(-1)!;
    expect(screen.getByLabelText('Zoom 100%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit to window' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Zoom 125%')).toBeInTheDocument();
    expect(image.style.transform).toContain('scale(1.25)');

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByLabelText('Zoom 80%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fit to window' }));
    expect(screen.getByLabelText('Zoom 100%')).toBeInTheDocument();
  });

  it('supports the keyboard and stops at the limits', async () => {
    const user = await openImage();
    await user.keyboard('+');
    expect(screen.getByLabelText('Zoom 125%')).toBeInTheDocument();
    await user.keyboard('0');
    expect(screen.getByLabelText('Zoom 100%')).toBeInTheDocument();
    for (let press = 0; press < 12; press++) await user.keyboard('+');
    expect(screen.getByLabelText('Zoom 800%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });

  it('toggles between fit and 200% on double-click', async () => {
    const user = await openImage();
    const frame = screen.getByTestId('image-viewer-frame');
    await user.dblClick(frame);
    expect(screen.getByLabelText('Zoom 200%')).toBeInTheDocument();
    await user.dblClick(frame);
    expect(screen.getByLabelText('Zoom 100%')).toBeInTheDocument();
  });
});

describe('attachments on a sent message', () => {
  it('renders image attachments as thumbnails that open the document preview', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('image bytes')));

    render(<UserMessage content="look at this" attachments={[{ documentId: 'doc-9', name: 'cat.png', mimeType: 'image/png', size: 3 }]} />);

    expect(screen.getByAltText('cat.png')).toHaveAttribute('src', '/api/documents/doc-9/content?preview=1');
    await user.click(screen.getByRole('button', { name: 'Preview cat.png' }));
    expect(await screen.findByRole('dialog', { name: 'cat.png' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download cat.png' })).toHaveAttribute('href', '/api/documents/doc-9/content');
  });

  it('shows deleted documents without a working preview', () => {
    render(<UserMessage content="old" attachments={[{ documentId: 'gone', name: 'plan.pdf', mimeType: 'application/pdf', size: 3, removed: true }]} />);

    expect(screen.getByRole('listitem', { name: /plan\.pdf, removed/ })).toHaveTextContent('Removed');
    expect(screen.queryByRole('button', { name: /Preview plan\.pdf/ })).toBeNull();
  });
});
