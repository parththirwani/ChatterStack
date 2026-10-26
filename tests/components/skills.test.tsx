import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SkillsPanel from '@/src/components/skills/SkillsPanel';
import { resetSkillsCache } from '@/src/lib/client/skills';
import { useAppStore } from '@/src/store/rootStore';
import type { User } from '@/src/types/user.types';
import type { Skill } from '@/src/types/skill.types';

const saved: Skill = {
  id: '5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a69', name: 'code-review', description: 'Review code for bugs.',
  instructions: 'List bugs by severity.', source: 'created', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

let skills: Skill[];
let fetcher: ReturnType<typeof vi.fn>;
const posted = (url: string) => fetcher.mock.calls
  .filter(([input, init]) => String(input) === url && (init as RequestInit | undefined)?.method === 'POST')
  .map(([, init]) => JSON.parse((init as RequestInit).body as string));

beforeEach(() => {
  resetSkillsCache();
  useAppStore.setState({ user: { id: 'user-1', name: 'Ada' } as User });
  skills = [{ ...saved }];
  fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (url === '/api/skills' && !init?.method) return Response.json({ skills });
    if (url === '/api/skills' && init?.method === 'POST') {
      const skill = { ...saved, ...body, id: crypto.randomUUID() };
      skills = [...skills, skill];
      return Response.json({ skill }, { status: 201 });
    }
    if (url === `/api/skills/${saved.id}` && init?.method === 'PATCH') {
      skills = [{ ...skills[0], ...body }];
      return Response.json({ skill: skills[0] });
    }
    if (url === `/api/skills/${saved.id}` && init?.method === 'DELETE') {
      skills = [];
      return new Response(null, { status: 204 });
    }
    if (url === '/api/skills/generate') {
      return Response.json({ draft: { name: 'haiku-writer', description: 'Answers as a haiku.', instructions: 'Use 5-7-5.' }, issues: [] });
    }
    if (url === '/api/skills/import') {
      return Response.json({ draft: { name: 'imported-one', description: '', instructions: 'Body' }, issues: [{ field: 'description', message: 'Add a description' }] });
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Skills panel', () => {
  it('lists skills, tags one on the composer, links its export and deletes after confirming', async () => {
    const user = userEvent.setup();
    const tagged = vi.fn();
    window.addEventListener('chatterstack:add-skill', tagged);
    try {
      render(<SkillsPanel />);
      expect(await screen.findByText('/code-review')).toBeInTheDocument();
      expect(screen.getByText('Review code for bugs.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Export code-review' })).toHaveAttribute('href', `/api/skills/${saved.id}/export`);

      await user.click(screen.getByRole('button', { name: 'Use code-review in chat' }));
      expect((tagged.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: saved.id, name: 'code-review' });

      await user.click(screen.getByRole('button', { name: 'Delete code-review' }));
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByText('/code-review')).toBeNull());
      expect(screen.getByText(/Skills are reusable instructions/)).toBeInTheDocument();
    } finally {
      window.removeEventListener('chatterstack:add-skill', tagged);
    }
  });

  it('says so when the composer cannot take the skill', async () => {
    const user = userEvent.setup();
    const refuse = (event: Event) => event.preventDefault();
    window.addEventListener('chatterstack:add-skill', refuse);
    try {
      render(<SkillsPanel />);
      await user.click(await screen.findByRole('button', { name: 'Use code-review in chat' }));
      expect(screen.getByRole('alert')).toHaveTextContent(/already has that skill or has 3 skills/);
    } finally {
      window.removeEventListener('chatterstack:add-skill', refuse);
    }
  });

  it('validates, then creates a skill and refreshes the list', async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await screen.findByText('/code-review');
    await user.click(screen.getByRole('button', { name: 'New skill' }));
    const dialog = screen.getByRole('dialog', { name: 'New skill' });

    await user.click(within(dialog).getByRole('button', { name: 'Create skill' }));
    expect(within(dialog).getByText('Add a name')).toBeInTheDocument();
    expect(posted('/api/skills')).toEqual([]);

    await user.type(within(dialog).getByLabelText('Name'), 'Release Notes');
    await user.tab(); // normalized on blur
    expect(within(dialog).getByLabelText('Name')).toHaveValue('release-notes');
    await user.type(within(dialog).getByLabelText('Description'), 'Write release notes.');
    await user.type(within(dialog).getByLabelText('Instructions'), 'Lead with user-facing changes.');
    await user.click(within(dialog).getByRole('button', { name: 'Create skill' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted('/api/skills')).toEqual([{
      name: 'release-notes', description: 'Write release notes.', instructions: 'Lead with user-facing changes.', source: 'created',
    }]);
    expect(await screen.findByText('/release-notes')).toBeInTheDocument();
  });

  it('drafts a skill with the skill creator and saves it as AI drafted', async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await screen.findByText('/code-review');
    await user.click(screen.getByRole('button', { name: 'New skill' }));
    const dialog = screen.getByRole('dialog', { name: 'New skill' });

    await user.type(within(dialog).getByLabelText('Skill creator'), 'answer in haiku');
    await user.click(within(dialog).getByRole('button', { name: 'Draft with AI' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveValue('haiku-writer'));
    expect(within(dialog).getByLabelText('Instructions')).toHaveValue('Use 5-7-5.');
    expect(posted('/api/skills/generate')).toEqual([{ request: 'answer in haiku' }]);
    // With a draft present, the creator revises it instead.
    expect(within(dialog).getByRole('button', { name: 'Revise with AI' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create skill' }));
    await waitFor(() => expect(posted('/api/skills')).toHaveLength(1));
    expect(posted('/api/skills')[0].source).toBe('generated');
  });

  it('imports pasted SKILL.md text into the editor for review, showing problems', async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await screen.findByText('/code-review');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const importDialog = screen.getByRole('dialog', { name: 'Import a skill' });
    await user.click(within(importDialog).getByLabelText('Skill file text'));
    await user.paste('---\nname: imported-one\n---\nBody');
    await user.click(within(importDialog).getByRole('button', { name: 'Continue' }));

    const editor = await screen.findByRole('dialog', { name: 'Review imported skill' });
    expect(posted('/api/skills/import')).toEqual([{ content: '---\nname: imported-one\n---\nBody' }]);
    expect(within(editor).getByLabelText('Name')).toHaveValue('imported-one');
    expect(within(editor).getByText('Add a description')).toBeInTheDocument();

    await user.type(within(editor).getByLabelText('Description'), 'Imported from Claude.');
    await user.click(within(editor).getByRole('button', { name: 'Create skill' }));
    await waitFor(() => expect(posted('/api/skills')).toHaveLength(1));
    expect(posted('/api/skills')[0]).toMatchObject({ name: 'imported-one', source: 'imported' });
  });

  it('imports a chosen file and rejects other file types', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<SkillsPanel />);
    await screen.findByText('/code-review');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const input = screen.getByLabelText('Choose a skill file');

    await user.upload(input, new File(['x'], 'skill.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a SKILL.md');

    await user.upload(input, new File(['---\nname: imported-one\n---\nBody'], 'SKILL.md', { type: 'text/markdown' }));
    await screen.findByRole('dialog', { name: 'Review imported skill' });
    expect(posted('/api/skills/import')[0].fileName).toBe('SKILL.md');
  });

  it('edits a saved skill in place', async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await screen.findByText('/code-review');
    // Both the name and the pencil open the editor.
    await user.click(screen.getAllByRole('button', { name: 'Edit code-review' })[1]);
    const dialog = screen.getByRole('dialog', { name: 'Edit /code-review' });
    const description = within(dialog).getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Find bugs fast.');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Find bugs fast.')).toBeInTheDocument());
    const patch = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({
      name: 'code-review', description: 'Find bugs fast.', instructions: 'List bugs by severity.',
    });
  });
});
