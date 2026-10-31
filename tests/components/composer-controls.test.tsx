import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSelectionProvider } from '@/src/context/ModelSelectionContext';
import { ModelSelector } from '@/src/components/chat/input/ModelSelector/ModelSelector';
import { ThinkingSelector } from '@/src/components/chat/input/ModelSelector/ThinkingSelector';
import { CouncilToggle } from '@/src/components/chat/input/CouncilToggle';
import { CHAT_MODELS } from '@/src/config/models';

const GPT = 'openai/gpt-6.1-sol';
const GEMINI = 'google/gemini-4-argon';
const CLAUDE = 'anthropic/claude-sonnet-5.5';
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash-1017';

function setup(storage: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  const user = userEvent.setup();
  render(
    <ModelSelectionProvider>
      <CouncilToggle />
      <ModelSelector />
      <ThinkingSelector />
    </ModelSelectionProvider>
  );
  return user;
}

const thinkingButton = () => screen.getByRole('button', { name: /^Thinking:/ });
const optionNames = (listbox: HTMLElement) =>
  within(listbox).getAllByRole('option').map((option) => option.querySelector('div > div')?.textContent);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('thinking control', () => {
  it('is its own dropdown, not part of the model menu', async () => {
    const user = setup({ selectedModel: GPT });
    await user.click(screen.getByRole('button', { name: /^Model:/ }));
    const modelMenu = screen.getByRole('dialog', { name: 'Model settings' });
    expect(within(modelMenu).queryByRole('button', { name: /^Thinking:/ })).toBeNull();
    expect(within(modelMenu).queryByRole('radiogroup')).toBeNull();

    expect(thinkingButton()).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it.each([
    [CLAUDE, ['Low', 'Medium', 'High', 'Extra high', 'Max']],
    [GPT, ['Low', 'Medium', 'High', 'Extra high', 'Max']],
    [GEMINI, ['Low', 'Medium', 'High']],
    [DEEPSEEK, ['Off', 'Low', 'High', 'Max']],
  ])('lists only the levels %s supports', async (model, expected) => {
    const user = setup({ selectedModel: model });
    await user.click(thinkingButton());
    expect(optionNames(screen.getByRole('listbox', { name: 'Thinking' }))).toEqual(expected);
  });

  it('shows the level the model actually uses when the preference is unsupported', () => {
    setup({ selectedModel: GEMINI, thinkingLevel: 'max' });
    expect(thinkingButton()).toHaveAccessibleName('Thinking: High');
  });

  it('selects a level with the keyboard and returns focus to the pill', async () => {
    const user = setup({ selectedModel: CLAUDE });
    await user.click(thinkingButton());
    const listbox = screen.getByRole('listbox', { name: 'Thinking' });
    expect(within(listbox).getByRole('option', { selected: true })).toHaveFocus();

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox', { name: 'Thinking' })).toBeNull();
    expect(thinkingButton()).toHaveAccessibleName('Thinking: Max');
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(thinkingButton()).toHaveFocus();
    expect(localStorage.getItem('thinkingLevel')).toBe('max');
  });

  it('in council mode, offers every member’s levels and says who uses a lower one', async () => {
    const user = setup({
      councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI, CLAUDE, DEEPSEEK], chair: GEMINI }),
      thinkingLevel: 'max',
    });
    await user.click(thinkingButton());
    const listbox = screen.getByRole('listbox', { name: 'Thinking' });
    expect(optionNames(listbox)).toEqual(['Off', 'Low', 'Medium', 'High', 'Extra high', 'Max']);
    expect(screen.getByText('Gemini 4 Argon uses High.')).toBeInTheDocument();
  });
});

describe('menus open below the trigger', () => {
  function layout({ triggerTop, viewport, menuHeight }: { triggerTop: number; viewport: number; menuHeight: number }) {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewport);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: triggerTop, bottom: triggerTop + 32, left: 0, right: 100, width: 100, height: 32, x: 0, y: triggerTop, toJSON() {},
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(menuHeight);
  }
  const menuOf = (button: HTMLElement) => button.parentElement!.querySelector('[data-popover-menu]') as HTMLElement;

  it('opens below when there is room', async () => {
    layout({ triggerTop: 300, viewport: 900, menuHeight: 300 });
    const user = setup({ selectedModel: CLAUDE });
    await user.click(thinkingButton());
    expect(menuOf(thinkingButton())).toHaveClass('top-full');
  });

  it('still opens below and scrolls when the menu is a bit taller than the space', async () => {
    layout({ triggerTop: 560, viewport: 860, menuHeight: 400 });
    const user = setup({ selectedModel: CLAUDE });
    await user.click(thinkingButton());
    const menu = menuOf(thinkingButton());
    expect(menu).toHaveClass('top-full');
    expect(menu).toHaveClass('overflow-y-auto');
    expect(parseInt(menu.style.maxHeight)).toBeLessThan(400);
  });

  it('only flips above when the composer sits at the bottom of the screen', async () => {
    layout({ triggerTop: 820, viewport: 900, menuHeight: 300 });
    const user = setup({ selectedModel: CLAUDE });
    await user.click(thinkingButton());
    expect(menuOf(thinkingButton())).toHaveClass('bottom-full');
  });

  it('applies to the model menu too', async () => {
    layout({ triggerTop: 300, viewport: 900, menuHeight: 260 });
    const user = setup({ selectedModel: CLAUDE });
    const button = screen.getByRole('button', { name: /^Model:/ });
    await user.click(button);
    expect(menuOf(button)).toHaveClass('top-full');
  });
});

describe('model picker', () => {
  const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /^Model:/ }));
    return screen.getByRole('dialog', { name: 'Model settings' });
  };

  it('lists providers first, marking the one the current model belongs to', async () => {
    const user = setup({ selectedModel: CLAUDE });
    const menu = await openPicker(user);

    const providers = within(menu).getByRole('list', { name: 'Providers' });
    expect(within(providers).getByRole('button', { name: 'Anthropic, current model Claude Sonnet 5.5' })).toBeInTheDocument();
    expect(within(providers).getByRole('button', { name: /^Google, \d+ models$/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('option')).toBeNull();
  });

  it('picks a model in two clicks: provider, then model', async () => {
    const user = setup({ selectedModel: CLAUDE });
    const menu = await openPicker(user);

    await user.click(within(menu).getByRole('button', { name: /^Google,/ }));
    const models = within(menu).getByRole('listbox', { name: 'Google models' });
    expect(within(models).getAllByRole('option').every((option) => option.textContent?.includes('Gemini') || option.textContent?.includes('Gemma'))).toBe(true);

    await user.click(within(models).getByRole('option', { name: /Gemini 4 Argon/ }));
    expect(screen.queryByRole('dialog', { name: 'Model settings' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Model:/ })).toHaveAccessibleName('Model: Gemini 4 Argon');
    expect(localStorage.getItem('selectedModel')).toBe(GEMINI);
  });

  it('opens a provider on its current model, and Escape steps back to the providers', async () => {
    const user = setup({ selectedModel: CLAUDE });
    const menu = await openPicker(user);

    await user.click(within(menu).getByRole('button', { name: /^Anthropic,/ }));
    expect(within(menu).getByRole('option', { selected: true })).toHaveTextContent('Claude Sonnet 5.5');
    expect(within(menu).getByRole('option', { selected: true })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Model settings' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /^Anthropic,/ })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Model settings' })).toBeNull();
  });

  it('lists a provider’s models newest release first', async () => {
    const user = setup({ selectedModel: CLAUDE });
    const menu = await openPicker(user);

    await user.click(within(menu).getByRole('button', { name: /^Anthropic,/ }));
    const names = optionNames(within(menu).getByRole('listbox', { name: 'Anthropic models' }));
    const released = names.map((name) => CHAT_MODELS.find((model) => model.name === name)!.released);
    expect(released).toEqual([...released].sort().reverse());
    expect(names.slice(0, 3)).toEqual(['Claude Haiku 5.5', 'Claude Sonnet 5.5', 'Claude Opus 5.5']);
  });

  it('keeps search results newest first within each provider', async () => {
    const user = setup({ selectedModel: CLAUDE });
    const menu = await openPicker(user);

    await user.type(within(menu).getByRole('searchbox', { name: 'Search models' }), 'sonnet');
    expect(optionNames(within(menu).getByRole('listbox', { name: 'Model' }))).toEqual([
      'Claude Sonnet 5.5', 'Claude Sonnet 5', 'Claude Sonnet 4.6', 'Claude Sonnet 4.5',
    ]);
  });

  it('the back button returns to the providers', async () => {
    const user = setup({ selectedModel: CLAUDE });
    const menu = await openPicker(user);

    await user.click(within(menu).getByRole('button', { name: /^Google,/ }));
    await user.click(within(menu).getByRole('button', { name: 'Back to providers from Google' }));
    expect(within(menu).getByRole('list', { name: 'Providers' })).toBeInTheDocument();
  });

  it('search skips the steps and lists matches from every provider', async () => {
    const user = setup({ selectedModel: CLAUDE });
    const menu = await openPicker(user);

    await user.type(within(menu).getByRole('searchbox', { name: 'Search models' }), 'gemini 4 argon');
    const results = within(menu).getByRole('listbox', { name: 'Model' });
    await user.click(within(results).getByRole('option', { name: /Gemini 4 Argon/ }));
    expect(screen.getByRole('button', { name: /^Model:/ })).toHaveAccessibleName('Model: Gemini 4 Argon');
  });
});

describe('council mode', () => {
  it('is a toggle that turns the model picker into council settings', async () => {
    const user = setup({ selectedModel: GPT });
    const toggle = screen.getByRole('button', { pressed: false, name: /Council/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName(/4 members/);
    expect(screen.getByRole('button', { name: 'Council settings' })).toHaveTextContent('Members');
  });

  it('lets the user pick 2 to 4 members, one provider at a time', async () => {
    const user = setup({ councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI, CLAUDE, DEEPSEEK], chair: GEMINI }) });
    await user.click(screen.getByRole('button', { name: 'Council settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Council settings' });
    const openProvider = (name: RegExp) => user.click(within(dialog).getByRole('button', { name }));
    const back = () => user.click(within(dialog).getByRole('button', { name: /^Back to providers/ }));

    await openProvider(/^Anthropic,/);
    await user.click(within(dialog).getByRole('checkbox', { name: /Claude Sonnet 5.5/ }));
    await back();
    await openProvider(/^DeepSeek,/);
    await user.click(within(dialog).getByRole('checkbox', { name: /^DeepSeek V4\.1 Flash / }));
    expect(screen.getByText('Minimum 2')).toBeInTheDocument();
    await back();

    await openProvider(/^OpenAI,/);
    const gpt = within(dialog).getByRole('checkbox', { name: /GPT-6.1 Sol/ });
    expect(gpt).toHaveAttribute('aria-disabled', 'true');
    await user.click(gpt);
    expect(gpt).toHaveAttribute('aria-checked', 'true');
    expect(JSON.parse(localStorage.getItem('councilSettings')!).members).toEqual([GPT, GEMINI]);
  });

  it('shows selected models and chair above the provider list', async () => {
    const user = setup({ councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI, CLAUDE], chair: GEMINI }) });
    await user.click(screen.getByRole('button', { name: 'Council settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Council settings' });

    const selected = within(dialog).getByRole('list', { name: 'Selected models' });
    expect(within(selected).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'GPT-6.1 Sol', 'Gemini 4 Argon', 'Claude Sonnet 5.5',
    ]);
    const chair = within(dialog).getByRole('button', { name: /Chair/ });
    const providers = within(dialog).getByRole('list', { name: 'Providers' });
    expect(selected.compareDocumentPosition(chair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chair.compareDocumentPosition(providers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(providers).getByRole('button', { name: 'OpenAI, members GPT-6.1 Sol' })).toBeInTheDocument();
    expect(within(providers).getByRole('button', { name: 'Anthropic, members Claude Sonnet 5.5' })).toBeInTheDocument();
    expect(within(providers).getByRole('button', { name: /^DeepSeek, \d+ models$/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();

    await user.click(within(selected).getByRole('button', { name: 'Deselect Claude Sonnet 5.5' }));
    expect(within(selected).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'GPT-6.1 Sol', 'Gemini 4 Argon',
    ]);
    expect(within(selected).getByRole('button', { name: 'Deselect Gemini 4 Argon' })).toHaveFocus();
    expect(within(selected).getByRole('button', { name: 'Deselect GPT-6.1 Sol' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(selected).getByRole('button', { name: 'Deselect GPT-6.1 Sol' }));
    expect(within(selected).getAllByRole('listitem')).toHaveLength(2);
  });

  it('updates the chair when deselecting it from the selected list', async () => {
    const user = setup({ councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI, CLAUDE], chair: GEMINI }) });
    await user.click(screen.getByRole('button', { name: 'Council settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Council settings' });
    const selected = within(dialog).getByRole('list', { name: 'Selected models' });

    await user.click(within(selected).getByRole('button', { name: 'Deselect Gemini 4 Argon' }));
    expect(within(dialog).getByRole('button', { name: /Chair/ })).toHaveTextContent('GPT-6.1 Sol');
    expect(JSON.parse(localStorage.getItem('councilSettings')!).members).toEqual([GPT, CLAUDE]);
    expect(JSON.parse(localStorage.getItem('councilSettings')!).chair).toBe(GPT);
  });

  it('shows a provider’s models newest first, and Escape steps back before closing', async () => {
    const user = setup({ councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI, CLAUDE], chair: GEMINI }) });
    await user.click(screen.getByRole('button', { name: 'Council settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Council settings' });

    await user.click(within(dialog).getByRole('button', { name: /^Anthropic,/ }));
    const names = within(dialog).getAllByRole('checkbox').map((box) => box.querySelector('div > div')?.textContent);
    const released = names.map((name) => CHAT_MODELS.find((model) => model.name === name)!.released);
    expect(released).toEqual([...released].sort().reverse());
    // Focus lands on the provider's member.
    expect(within(dialog).getByRole('checkbox', { name: /Claude Sonnet 5.5/ })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: /^Anthropic,/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Council settings' })).toBeNull();
  });

  it('search lists matching members from every provider', async () => {
    const user = setup({ councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI, CLAUDE], chair: GEMINI }) });
    await user.click(screen.getByRole('button', { name: 'Council settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Council settings' });

    await user.type(within(dialog).getByRole('searchbox', { name: 'Search models' }), '5.5');
    const group = within(dialog).getByRole('group', { name: 'Council members' });
    expect(within(group).getByRole('group', { name: 'Anthropic' })).toBeInTheDocument();
    expect(within(group).getByRole('group', { name: 'OpenAI' })).toBeInTheDocument();
  });

  it('uses a themed chair list instead of the browser’s native select', async () => {
    const user = setup({ councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI, CLAUDE], chair: GEMINI }) });
    await user.click(screen.getByRole('button', { name: 'Council settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Council settings' });
    expect(dialog.querySelector('select')).toBeNull();

    const chairButton = within(dialog).getByRole('button', { name: /Chair/ });
    expect(chairButton).toHaveTextContent('Gemini 4 Argon');
    await user.click(chairButton);

    const list = within(dialog).getByRole('listbox', { name: 'Chair' });
    // Only members can chair.
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['GPT-6.1 Sol', 'Gemini 4 Argon', 'Claude Sonnet 5.5']);
    expect(within(list).getByRole('option', { selected: true })).toHaveFocus();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(chairButton).toHaveTextContent('Claude Sonnet 5.5');
    expect(within(dialog).queryByRole('listbox', { name: 'Chair' })).toBeNull();
  });

  it('Escape closes just the chair list, not the whole menu', async () => {
    const user = setup({ councilSettings: JSON.stringify({ enabled: true, members: [GPT, GEMINI], chair: GEMINI }) });
    await user.click(screen.getByRole('button', { name: 'Council settings' }));
    await user.click(screen.getByRole('button', { name: /Chair/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Chair' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Council settings' })).toBeInTheDocument();
  });
});
