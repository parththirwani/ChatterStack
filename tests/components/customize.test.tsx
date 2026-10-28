import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SkillsPage from '@/src/components/customize/SkillsPage';
import SkillEditorHost from '@/src/components/customize/SkillEditorHost';
import MarkdownContent from '@/src/components/chat/messages/AIMessage/MarkdownContent';
import { resetSkillsCache } from '@/src/lib/client/skills';
import { useAppStore } from '@/src/store/rootStore';
import type { Skill } from '@/src/types/skill.types';
import type { User } from '@/src/types/user.types';

const base: Skill = {
  id: '5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a69', name: 'unslop', description: 'Cut AI tells from any writing.',
  instructions: '# Unslop\n\nRemove filler.', source: 'created', enabled: true, categories: ['Writing', 'Code'],
  files: [{ path: 'references/words.md', content: '# Words' }], frontmatter: 'license: MIT', version: 3, catalogId: null,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
};
const added: Skill = { ...base, id: 'c0de0000-0000-4000-8000-000000000000', name: 'code-review', description: 'Review code.', source: 'catalog', catalogId: 'code-review', files: [], frontmatter: undefined };

let skills: Skill[];
let fetcher: ReturnType<typeof vi.fn>;
const calls = (method: string, url: string | RegExp) => fetcher.mock.calls.filter(([input, init]) =>
  (init as RequestInit | undefined)?.method === method && (typeof url === 'string' ? String(input) === url : url.test(String(input))));
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

beforeEach(() => {
  resetSkillsCache();
  window.history.replaceState(null, '', '/customize/skills/yours');
  useAppStore.setState({ user: { id: 'user-1', name: 'Ada' } as User, drafts: {}, draftsOwner: 'user-1' });
  skills = [{ ...base }, { ...added }];
  fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/skills' && method === 'GET') return Response.json({ skills });
    if (url === '/api/skills' && method === 'POST') {
      const skill = { ...base, ...JSON.parse(init!.body as string), id: crypto.randomUUID(), version: 1 };
      skills = [...skills, skill];
      return Response.json({ skill }, { status: 201 });
    }
    if (url === '/api/skills/catalog') {
      const { id } = JSON.parse(init!.body as string);
      const existing = skills.find((skill) => skill.catalogId === id);
      if (existing) return Response.json({ skill: existing });
      // Like the server: the user's own skill keeps the name.
      const name = skills.some((skill) => skill.name === id) ? `${id}-2` : id;
      const skill = { ...added, id: `catalog-${id}`, name, catalogId: id };
      skills = [...skills, skill];
      return Response.json({ skill });
    }
    if (url === '/api/skills/upload') {
      return Response.json({ results: [
        { fileName: 'good.zip', skill: { ...base, name: 'brand-voice' }, checks: ['SKILL.md found and its frontmatter is valid'], warnings: ['Scripts are stored but never run in ChatterStack: scripts/a.py'] },
        { fileName: 'bad.md', error: 'The file must start with YAML frontmatter containing name and description.', checks: [], warnings: [] },
      ] });
    }
    const match = url.match(/^\/api\/skills\/([^/]+)$/);
    if (match && method === 'PATCH') {
      skills = skills.map((skill) => (skill.id === match[1] ? { ...skill, ...JSON.parse(init!.body as string) } : skill));
      return Response.json({ skill: skills.find((skill) => skill.id === match[1]) });
    }
    if (match && method === 'DELETE') {
      skills = skills.filter((skill) => skill.id !== match[1]);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Customize → Skills → Yours', () => {
  it('lists your skills and ChatterStack ones separately, with categories and dates', async () => {
    render(<SkillsPage view={{ kind: 'skills', tab: 'yours' }} />);
    const mine = await screen.findByRole('region', { name: 'Created by you' });
    expect(within(mine).getByText('unslop')).toBeInTheDocument();
    expect(within(mine).getByText('Writing')).toBeInTheDocument();
    expect(within(mine).getByText('+1')).toBeInTheDocument();
    expect(within(mine).getByText(/by you · Cut AI tells/)).toBeInTheDocument();
    const fromUs = screen.getByRole('region', { name: 'From ChatterStack' });
    expect(within(fromUs).getByText(/from ChatterStack · Review code/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Yours' })).toHaveAttribute('aria-checked', 'true');
  });

  it('credits the upstream source for an added catalog skill', async () => {
    skills.push({ ...added, id: 'external-1', name: 'ask-matt', catalogId: 'mattpocock-ask-matt' });
    render(<SkillsPage view={{ kind: 'skills', tab: 'yours' }} />);
    const external = await screen.findByRole('region', { name: 'From other creators' });
    expect(within(external).getByText(/from mattpocock\/skills/)).toBeInTheDocument();
  });

  it('turns a skill off and removes one after confirming', async () => {
    const user = userEvent.setup();
    render(<SkillsPage view={{ kind: 'skills', tab: 'yours' }} />);
    await user.click(await screen.findByRole('button', { name: 'Turn off unslop' }));
    expect(bodyOf(calls('PATCH', `/api/skills/${base.id}`)[0])).toEqual({ enabled: false });
    expect(await screen.findByRole('button', { name: 'Turn on unslop' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More actions for code-review' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Remove code-review?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'From ChatterStack' })).toBeNull());
    expect(calls('DELETE', `/api/skills/${added.id}`)).toHaveLength(1);
  });

  it('filters with search', async () => {
    const user = userEvent.setup();
    render(<SkillsPage view={{ kind: 'skills', tab: 'yours' }} />);
    await screen.findByText('unslop');
    await user.type(screen.getByRole('searchbox', { name: 'Search skills' }), 'review');
    expect(screen.queryByText('unslop')).toBeNull();
    expect(screen.getByText('code-review')).toBeInTheDocument();
  });

  it('offers Upload skill, Create a skill and Create with AI', async () => {
    const user = userEvent.setup();
    render(<><SkillsPage view={{ kind: 'skills', tab: 'yours' }} /><SkillEditorHost /></>);
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Upload skill', 'Create a skill', 'Create with AI']);

    await user.click(screen.getByRole('menuitem', { name: 'Upload skill' }));
    expect(window.location.pathname).toBe('/customize/skills/new/upload');

    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create a skill' }));
    expect(screen.getByRole('dialog', { name: 'Create a skill' })).toBeInTheDocument();
  });

  it('Create with AI adds skill-creator and opens a chat with the prompt typed', async () => {
    const user = userEvent.setup();
    const newChat = vi.fn();
    window.addEventListener('chatterstack:new-chat', newChat);
    try {
      render(<SkillsPage view={{ kind: 'skills', tab: 'yours' }} />);
      await user.click(screen.getByRole('button', { name: 'Add skill' }));
      await user.click(screen.getByRole('menuitem', { name: 'Create with AI' }));
      await waitFor(() => expect(newChat).toHaveBeenCalled());
      expect(bodyOf(calls('POST', '/api/skills/catalog')[0])).toEqual({ id: 'skill-creator' });
      expect(useAppStore.getState().drafts.new).toBe("Let's create a skill together using /skill-creator. First ask me what the skill should do.");
    } finally {
      window.removeEventListener('chatterstack:new-chat', newChat);
    }
  });
});

describe('starting a chat from a skill', () => {
  it('Create with AI tags skill-creator by the name it was added under', async () => {
    skills.push({ ...base, id: 'f00d0000-0000-4000-8000-000000000000', name: 'skill-creator' });
    const user = userEvent.setup();
    render(<SkillsPage view={{ kind: 'skills', tab: 'yours' }} />);
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create with AI' }));
    await waitFor(() => expect(useAppStore.getState().drafts.new).toBe("Let's create a skill together using /skill-creator-2. First ask me what the skill should do."));
  });

  it('Try in chat turns a turned-off skill on, so the tag applies', async () => {
    skills = [{ ...base, enabled: false }];
    const user = userEvent.setup();
    render(<SkillsPage view={{ kind: 'skills', tab: 'skill', skillId: base.id, section: 'overview' }} />);
    await user.click(await screen.findByRole('button', { name: 'More options for unslop' }));
    await user.click(screen.getByRole('menuitem', { name: 'Try in chat' }));
    await waitFor(() => expect(useAppStore.getState().drafts.new).toBe('/unslop '));
    expect(bodyOf(calls('PATCH', `/api/skills/${base.id}`)[0])).toEqual({ enabled: true });
  });
});

describe('Customize → Skills → Discover', () => {
  it('suggests catalog skills, adds one, and Try opens a chat with it tagged', async () => {
    const user = userEvent.setup();
    render(<SkillsPage view={{ kind: 'skills', tab: 'discover' }} />);
    const featured = await screen.findByRole('region', { name: 'From ChatterStack' });
    expect(within(featured).getByText('skill-creator')).toBeInTheDocument();
    const suggested = screen.getByRole('region', { name: 'Suggested skills' });
    expect(within(suggested).queryByText('skill-creator')).toBeNull();
    // Already added, so it shows a check instead of +.
    await waitFor(() => expect(within(suggested).getByLabelText('code-review added')).toBeInTheDocument());

    await user.click(within(suggested).getByRole('button', { name: 'Add meeting-notes' }));
    expect(bodyOf(calls('POST', '/api/skills/catalog')[0])).toEqual({ id: 'meeting-notes' });
    expect(await within(suggested).findByLabelText('meeting-notes added')).toBeInTheDocument();

    await user.click(within(suggested).getByRole('button', { name: 'Add release-notes and try it in chat' }));
    await waitFor(() => expect(useAppStore.getState().drafts.new).toBe('/release-notes '));
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    render(<SkillsPage view={{ kind: 'skills', tab: 'discover' }} />);
    await user.click(await screen.findByRole('button', { name: /^Jobs & career/ }));
    const suggested = screen.getByRole('region', { name: 'Suggested skills' });
    expect(within(suggested).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['cover-letter']);
  });

  it('filters the three stacks and adds a whole stack', async () => {
    const user = userEvent.setup();
    render(<SkillsPage view={{ kind: 'skills', tab: 'discover' }} />);
    const stacks = await screen.findByRole('region', { name: 'Stacks' });
    expect(within(stacks).getAllByRole('button').map((button) => button.textContent)).toEqual(['Coding', 'UI', 'Writing']);

    await user.click(within(stacks).getByRole('button', { name: 'UI' }));
    const sources = screen.getByRole('region', { name: 'Sources' });
    await user.click(within(sources).getByRole('button', { name: 'lucasmarkes/hairline 2' }));
    const suggested = screen.getByRole('region', { name: 'Suggested skills' });
    expect(within(suggested).getByRole('heading', { name: 'UI', level: 3 })).toBeInTheDocument();
    expect(within(suggested).getByText('hairline-create')).toBeInTheDocument();
    expect(within(suggested).getByText('hairline-adopt')).toBeInTheDocument();
    expect(within(suggested).queryByText('design-taste')).toBeNull();
    expect(within(suggested).queryByText('ponytail')).toBeNull();
    expect(within(suggested).getAllByRole('link', { name: 'lucasmarkes/hairline' })).toHaveLength(2);

    await user.click(within(suggested).getByRole('button', { name: 'Add UI stack' }));
    await waitFor(() => expect(calls('POST', '/api/skills/catalog').map(bodyOf)).toEqual([
      { id: 'hairline-hairline-adopt' }, { id: 'hairline-hairline-create' },
    ]));
    await waitFor(() => expect(within(suggested).getByRole('button', { name: 'Added' })).toBeDisabled());
  });
});

describe('Upload a skill', () => {
  it('takes several .md, .zip and .skill files and reports each result', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<SkillsPage view={{ kind: 'skills', tab: 'upload' }} />);
    expect(screen.getByText('.md file must contain skill name and description formatted in YAML')).toBeInTheDocument();
    expect(screen.getByText('.zip or .skill file must include a SKILL.md file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();

    const input = screen.getByLabelText('Choose skill files');
    expect(input).toHaveAttribute('accept', '.md,.zip,.skill');
    await user.upload(input, new File(['x'], 'notes.pdf'));
    expect(screen.getByRole('alert')).toHaveTextContent("notes.pdf isn't a .md, .zip or .skill file.");

    await user.upload(input, [new File(['zip'], 'good.zip'), new File(['md'], 'bad.md'), new File(['s'], 'other.skill')]);
    expect(within(screen.getByRole('list', { name: 'Files to upload' })).getAllByRole('listitem')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Remove other.skill' }));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    const form = (calls('POST', '/api/skills/upload')[0][1] as RequestInit).body as FormData;
    expect((form.getAll('files') as File[]).map((file) => file.name)).toEqual(['good.zip', 'bad.md']);
    const results = await screen.findByRole('list', { name: 'Upload results' });
    expect(within(results).getByText(/never run in ChatterStack/)).toBeInTheDocument();
    expect(within(results).getByText(/must start with YAML frontmatter/)).toBeInTheDocument();
    expect(within(results).getByRole('button', { name: 'Open brand-voice' })).toBeInTheDocument();
    // The failed file stays so it can be fixed and retried.
    expect(within(screen.getByRole('list', { name: 'Files to upload' })).getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('a skill page', () => {
  it('shows the overview, and contents with frontmatter and files', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SkillsPage view={{ kind: 'skills', tab: 'skill', skillId: base.id, section: 'overview' }} />);
    expect(await screen.findByRole('heading', { name: 'unslop' })).toBeInTheDocument();
    expect(screen.getByText(/by you · v3 · updated/)).toBeInTheDocument();
    expect(screen.getByText('Its 1 other file is stored and downloadable, but not sent to the model.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contents · 2' })).toHaveAttribute('href', `/customize/skills/${base.id}/contents`);

    await user.click(screen.getByRole('switch', { name: 'unslop' }));
    expect(bodyOf(calls('PATCH', `/api/skills/${base.id}`)[0])).toEqual({ enabled: false });

    await user.click(screen.getByRole('button', { name: 'More options for unslop' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Try in chat', 'Edit with AI', 'Edit', 'Replace', 'Duplicate', 'Download', 'Remove']);
    await user.keyboard('{Escape}');

    rerender(<SkillsPage view={{ kind: 'skills', tab: 'skill', skillId: base.id, section: 'contents' }} />);
    expect(screen.getByRole('rowheader', { name: 'license' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unslop' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'references/words.md' }));
    expect(screen.getByRole('heading', { name: 'Words' })).toBeInTheDocument();
  });
});

describe('Create a skill dialog', () => {
  it('validates, then creates a skill with extra files', async () => {
    const user = userEvent.setup();
    render(<><SkillsPage view={{ kind: 'skills', tab: 'yours' }} /><SkillEditorHost /></>);
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create a skill' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a skill' });

    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByText('Add a name')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Skill name'), 'Weekly Status');
    await user.type(within(dialog).getByLabelText('Description'), 'Write weekly status reports.');
    await user.type(within(dialog).getByLabelText('Instructions'), 'Three sections.');
    await user.click(within(dialog).getByRole('button', { name: 'Add file' }));
    await user.type(within(dialog).getByLabelText('File path'), '../escape.md');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByText(/relative path/)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('File path'));
    await user.type(within(dialog).getByLabelText('File path'), 'templates/report.md');
    await user.type(within(dialog).getByLabelText('Contents of templates/report.md'), '## Wins');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodyOf(calls('POST', '/api/skills')[0])).toEqual({
      name: 'weekly-status', description: 'Write weekly status reports.', instructions: 'Three sections.',
      files: [{ path: 'templates/report.md', content: '## Wins' }], source: 'created',
    });
    expect(window.location.pathname).toMatch(/^\/customize\/skills\/[0-9a-f-]{36}$/);
  });

  it('opens prefilled from "Save as skill" under a SKILL.md drafted in chat', async () => {
    const user = userEvent.setup();
    const answer = 'Here it is:\n\n```markdown\n---\nname: haiku-writer\ndescription: Answers as a haiku.\n---\n\nUse 5-7-5.\n```\n\nAnd some ```text``` not a skill.\n\n```python\nprint(1)\n```';
    render(<><MarkdownContent content={answer} /><SkillEditorHost /></>);
    expect(screen.getAllByRole('button', { name: 'Save as skill' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Save as skill' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a skill' });
    expect(within(dialog).getByLabelText('Skill name')).toHaveValue('haiku-writer');
    expect(within(dialog).getByLabelText('Instructions')).toHaveValue('Use 5-7-5.');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls('POST', '/api/skills')).toHaveLength(1));
    expect(bodyOf(calls('POST', '/api/skills')[0]).source).toBe('generated');
  });
});
