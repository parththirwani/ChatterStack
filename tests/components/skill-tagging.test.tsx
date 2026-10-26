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
import type { SkillTag } from '@/src/types/skill.types';
import type { User } from '@/src/types/user.types';

const skill = (name: string, description: string, index: number) => ({
  id: `5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a6${index}`, name, description, instructions: 'x', source: 'created',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
});
const SKILLS = [
  skill('code-review', 'Find bugs by severity', 0),
  skill('release-notes', 'Write a changelog', 1),
  skill('review-pr', 'Review a pull request', 2),
  skill('haiku', 'Answer as a haiku', 3),
];

let onSend: ReturnType<typeof vi.fn>;
let latest: { message: string; skills: SkillTag[] };

function Composer({ initialSkills = [] }: { initialSkills?: SkillTag[] }) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [skills, setSkills] = useState<SkillTag[]>(initialSkills);
  latest = { message, skills };
  return (
    <ModelSelectionProvider>
      <MessageInput
        message={message}
        onMessageChange={setMessage}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        skills={skills}
        onSkillsChange={setSkills}
        onSendMessage={onSend}
        loading={false}
      />
    </ModelSelectionProvider>
  );
}

const textbox = () => screen.getByRole('textbox', { name: 'Message' });
const optionNames = () => within(screen.getByRole('listbox', { name: 'Skills' })).queryAllByRole('option')
  .map((option) => option.firstElementChild?.textContent);

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

describe('tagging skills in the composer', () => {
  it('opens a filtered picker on /, tags the chosen skill with Enter, and removes the typed query', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), 'Please /rev');
    await waitFor(() => expect(optionNames()).toEqual(['/review-pr', '/code-review']));
    expect(textbox()).toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(latest).toEqual({ message: 'Please ', skills: [{ id: SKILLS[0].id, name: 'code-review' }] });
    expect(screen.getByText('/code-review')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();

    // Already-tagged skills aren't offered again.
    await user.type(textbox(), '/');
    await waitFor(() => expect(optionNames()).not.toContain('/code-review'));
  });

  it('closes on Escape so Enter sends, and ignores slashes inside words', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), 'and/or');
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.type(textbox(), ' /co');
    await screen.findByRole('listbox', { name: 'Skills' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
    expect(latest.skills).toEqual([]);
  });

  it('says when nothing matches and lets Enter send the text', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), '/zzz');
    expect(await screen.findByText('No skills match “/zzz”.')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('opens the picker from the Skills button and tags with a click', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(textbox(), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Tag a skill' }));
    expect(textbox()).toHaveValue('Hello /');
    await user.click(await screen.findByRole('option', { name: /haiku/ }));
    expect(latest).toEqual({ message: 'Hello ', skills: [{ id: SKILLS[3].id, name: 'haiku' }] });
  });

  it('removes a tagged skill from its chip', async () => {
    const user = userEvent.setup();
    render(<Composer initialSkills={[{ id: SKILLS[1].id, name: 'release-notes' }]} />);
    await user.click(screen.getByRole('button', { name: 'Remove skill release-notes' }));
    expect(latest.skills).toEqual([]);
  });

  it('stops at three skills per message', async () => {
    const user = userEvent.setup();
    render(<Composer initialSkills={SKILLS.slice(0, 3).map(({ id, name }) => ({ id, name }))} />);
    await user.type(textbox(), '/ha');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Tag up to 3 skills per message.');
    expect(latest.skills).toHaveLength(3);
    expect(latest.message).toBe('/ha');
  });

  it('does not offer skills to signed-out users', async () => {
    useAppStore.setState({ user: null });
    const user = userEvent.setup();
    render(<Composer />);
    expect(screen.queryByRole('button', { name: 'Tag a skill' })).toBeNull();
    await user.type(textbox(), '/co');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(fetch).not.toHaveBeenCalledWith('/api/skills', expect.anything());
  });
});

describe('sent messages', () => {
  it('show their skills, with deleted ones struck through', () => {
    render(<UserMessage content="Check this" skills={[{ id: 'a', name: 'code-review' }, { id: 'b', name: 'old', removed: true }]} />);
    const list = screen.getByRole('list', { name: 'Skills used' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['/code-review', '/old (deleted)']);
  });
});
