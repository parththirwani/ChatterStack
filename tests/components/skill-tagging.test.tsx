import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageInput from '@/src/components/chat/input/MessageInput';
import UserMessage from '@/src/components/chat/messages/UserMessage/UserMessage';
import { ModelSelectionProvider } from '@/src/context/ModelSelectionContext';
import { resetSkillsCache } from '@/src/lib/client/skills';
import { useAppStore } from '@/src/store/rootStore';
import type { DocumentAttachment } from '@/src/types/chat.types';
import type { User } from '@/src/types/user.types';

const skill = (name: string, description: string, index: number, enabled = true) => ({
  id: `5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a6${index}`, name, description, instructions: 'x', source: 'created',
  enabled, categories: [], files: [], version: 1, catalogId: null,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
});
const SKILLS = [
  skill('code-review', 'Find bugs by severity', 0),
  skill('release-notes', 'Write a changelog', 1),
  skill('review-pr', 'Review a pull request', 2),
  skill('haiku', 'Answer as a haiku', 3),
  skill('turned-off', 'Hidden while off', 4, false),
];

let onSend: ReturnType<typeof vi.fn>;
let latest: { message: string };

function Composer({ initial = '' }: { initial?: string }) {
  const [message, setMessage] = useState(initial);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  latest = { message };
  return (
    <ModelSelectionProvider>
      <MessageInput message={message} onMessageChange={setMessage} attachments={attachments} onAttachmentsChange={setAttachments} onSendMessage={onSend} loading={false} />
    </ModelSelectionProvider>
  );
}

const textbox = () => screen.getByRole('textbox', { name: 'Message' });
const optionNames = () => within(screen.getByRole('listbox', { name: 'Skills and actions' })).queryAllByRole('option')
  .map((option) => option.querySelector('span > span')?.textContent);
const tokens = () => [...document.querySelectorAll('[data-skill-token]')].map((token) => token.textContent);

beforeEach(() => {
  resetSkillsCache();
  onSend = vi.fn();
  useAppStore.setState({ user: { id: 'user-1', name: 'Ada' } as User });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/skills') return Response.json({ skills: SKILLS });
    return Response.json({});
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the / menu in the composer', () => {
  it('offers Add files and turned-on skills, like claude.ai', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), '/');
    await waitFor(() => expect(optionNames()).toEqual(['Add files', 'code-review', 'release-notes', 'review-pr', 'haiku']));
    expect(optionNames()).not.toContain('turned-off');
  });

  it('filters as you type and inserts the skill as an inline, highlighted /token', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), 'Please /rev');
    await waitFor(() => expect(optionNames()).toEqual(['review-pr', 'code-review']));
    expect(textbox()).toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(latest.message).toBe('Please /code-review ');
    expect(tokens()).toEqual(['/code-review']);
    expect(onSend).not.toHaveBeenCalled();

    // Typing continues right after the token.
    await user.keyboard('this');
    expect(latest.message).toBe('Please /code-review this');

    // Already-tagged skills aren't offered again.
    await user.type(textbox(), ' /');
    await waitFor(() => expect(optionNames()).not.toContain('code-review'));
  });

  it('Add files removes the /query and opens the file picker', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    await user.type(textbox(), 'Look /add');
    await waitFor(() => expect(optionNames()).toEqual(['Add files']));
    await user.keyboard('{Enter}');
    expect(latest.message).toBe('Look ');
    expect(click).toHaveBeenCalled();
  });

  it('closes on Escape so Enter sends, and ignores slashes inside words', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), 'and/or');
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.type(textbox(), ' /co');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('says when nothing matches and lets Enter send the text', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), '/zzz');
    expect(await screen.findByText('No skills match “/zzz”.')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('picks with a click', async () => {
    const user = userEvent.setup();
    render(<Composer initial="Hello " />);
    await user.click(textbox());
    await user.keyboard('/ha');
    await user.click(await screen.findByRole('option', { name: /haiku/ }));
    expect(latest.message).toBe('Hello /haiku ');
  });

  it('stops at three skills per message', async () => {
    const user = userEvent.setup();
    render(<Composer initial="/code-review /release-notes /review-pr " />);
    await user.click(textbox());
    await user.keyboard('/ha');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Use up to 3 skills per message.');
    expect(latest.message).toBe('/code-review /release-notes /review-pr /ha');
  });

  it('highlights only known, turned-on skill names', async () => {
    render(<Composer initial="/haiku and /turned-off and /nope" />);
    await waitFor(() => expect(tokens()).toEqual(['/haiku']));
  });

  it('does not offer skills to signed-out users', async () => {
    useAppStore.setState({ user: null });
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), '/co');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(fetch).not.toHaveBeenCalledWith('/api/skills', expect.anything());
  });
});

describe('sent messages', () => {
  it('highlight their skills inline, with deleted ones struck through', () => {
    render(<UserMessage content="/code-review check /old this" skills={[{ id: 'a', name: 'code-review' }, { id: 'b', name: 'old', removed: true }]} />);
    expect(tokens()).toEqual(['/code-review', '/old (deleted skill)']);
    expect(document.querySelector('[data-skill-token="old"]')).toHaveClass('line-through');
    expect(screen.getByText(/check/)).toBeInTheDocument();
  });
});
