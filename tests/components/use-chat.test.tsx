/**
 * The chat flow behind the sidebar: a new chat shows up the moment it is sent,
 * keeps streaming after "New chat", and gets its generated title live.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChatRequest } from '@/src/types/chat.types';
import type { ChatStreamHandlers } from '@/src/services/api';

// Chat URLs change with history.replaceState, never a Next.js navigation
// (which would re-request the page and remount the app).
const replace = vi.fn();
const routerNavigations = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: routerNavigations, push: routerNavigations }) }));
vi.mock('@/src/services/apiOptimizer', () => ({ cacheInvalidators: { conversationList: vi.fn() } }));

interface Call {
  request: ChatRequest;
  handlers: ChatStreamHandlers;
  signal: AbortSignal;
  finish: () => void;
  fail: (error: Error) => void;
}
const calls: Call[] = [];
const skillTagsIn = vi.hoisted(() => vi.fn(() => [] as { id: string; name: string }[]));
vi.mock('@/src/lib/client/skills', () => ({ skillTagsIn }));
vi.mock('@/src/services/api', () => ({
  ApiService: {
    sendMessage: (request: ChatRequest, handlers: ChatStreamHandlers, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        calls.push({ request, handlers, signal, finish: resolve, fail: reject });
      }),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(async () => {}),
  },
}));

const { useChat } = await import('@/src/hooks/useChat');
const { ModelSelectionProvider, useModelSelection } = await import('@/src/context/ModelSelectionContext');
const { useAppStore } = await import('@/src/store/rootStore');

const wrapper = ({ children }: { children: React.ReactNode }) => <ModelSelectionProvider>{children}</ModelSelectionProvider>;
const state = () => useAppStore.getState();

beforeEach(() => {
  skillTagsIn.mockReturnValue([]);
  calls.length = 0;
  replace.mockReset();
  routerNavigations.mockReset();
  window.history.replaceState(null, '', '/');
  vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => replace(args[2]));
  useAppStore.setState({
    user: { id: 'u1', name: 'T', email: 't@example.com', avatarUrl: null },
    conversations: [],
    chatState: {},
    queues: {},
    queuesPaused: {},
    currentConversationId: undefined,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(routerNavigations).not.toHaveBeenCalled();
});

async function startNewChat(text = 'Explain TCP congestion control') {
  const hook = renderHook(() => useChat('new'), { wrapper });
  await waitFor(() => expect(hook.result.current.sendMessage).toBeTypeOf('function'));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.sendMessage(text);
  });
  await waitFor(() => expect(calls).toHaveLength(1));
  return { hook, pending, call: calls[0], id: calls[0].request.conversationId! };
}

describe('starting a new chat', () => {
  it('adds it to the sidebar immediately, before the server answers', async () => {
    const { id, call } = await startNewChat();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.request.newConversation).toBe(true);
    expect(state().conversations.map((c) => c.id)).toEqual([id]);
    expect(state().conversations[0].messages?.[0].content).toBe('Explain TCP congestion control');
    expect(state().chatState[id].loading).toBe(true);
    expect(state().currentConversationId).toBe(id);
    call.finish();
  });

  it('sends the chosen thinking level', async () => {
    localStorage.setItem('thinkingLevel', 'xhigh');
    localStorage.setItem('selectedModel', 'anthropic/claude-sonnet-5.5');
    const { call } = await startNewChat();
    expect(call.request.thinkingLevel).toBe('xhigh');
    expect(call.request.selectedModel).toBe('anthropic/claude-sonnet-5.5');
    call.finish();
  });

  it('sends council members and chair in council mode', async () => {
    localStorage.setItem('councilSettings', JSON.stringify({
      enabled: true, members: ['openai/gpt-6.1-sol', 'google/gemini-4-argon'], chair: 'google/gemini-4-argon',
    }));
    const { call } = await startNewChat();
    expect(call.request.selectedModel).toBe('council');
    expect(call.request.council).toEqual({ members: ['openai/gpt-6.1-sol', 'google/gemini-4-argon'], chair: 'google/gemini-4-argon' });
    call.finish();
  });

  it('sends tagged skill ids and shows the tags on the question', async () => {
    skillTagsIn.mockReturnValueOnce([{ id: 's1', name: 'code-review' }]);
    const hook = renderHook(() => useChat('new'), { wrapper });
    act(() => {
      void hook.result.current.sendMessage('Review this with /code-review');
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].request.skills).toEqual(['s1']);
    const id = calls[0].request.conversationId!;
    expect(state().chatState[id].messages[0].skills).toEqual([{ id: 's1', name: 'code-review' }]);
    calls[0].finish();
  });

  it('sends no skills field when none are tagged', async () => {
    const { call } = await startNewChat();
    expect(call.request).not.toHaveProperty('skills', expect.anything());
    call.finish();
  });

  it('moves the URL to the chat once the server has saved it', async () => {
    const { call, id } = await startNewChat();
    act(() => call.handlers.onConversationCreated?.(id));
    expect(replace).toHaveBeenCalledWith(`/${id}`);
    call.finish();
  });

  it('shows the generated title as soon as it arrives', async () => {
    const { call, id } = await startNewChat();
    act(() => call.handlers.onTitle?.('TCP Congestion Control'));
    expect(state().conversations.find((c) => c.id === id)?.title).toBe('TCP Congestion Control');
    call.finish();
  });

  it('streams reasoning and answer into the reply', async () => {
    const { call, id, pending } = await startNewChat();
    act(() => {
      call.handlers.onReasoning?.('Weighing it');
      call.handlers.onChunk?.('Slow start.');
      call.handlers.onDone?.();
      call.finish();
    });
    await act(() => pending);
    const reply = state().chatState[id].messages.at(-1)!;
    expect(reply).toMatchObject({ role: 'assistant', content: 'Slow start.', reasoning: 'Weighing it' });
    expect(reply.reasoningDurationMs).toBeTypeOf('number');
    expect(state().chatState[id].loading).toBe(false);
  });
});

describe('clicking New chat while a reply is streaming', () => {
  it('keeps the chat in the sidebar, marked as streaming, and lets it finish', async () => {
    const { hook, call, id, pending } = await startNewChat();
    act(() => call.handlers.onConversationCreated?.(id));

    act(() => hook.result.current.startNewConversation());
    expect(state().currentConversationId).toBeUndefined();
    expect(call.signal.aborted).toBe(false);
    expect(state().conversations.map((c) => c.id)).toEqual([id]);
    expect(state().chatState[id].loading).toBe(true);

    act(() => {
      call.handlers.onChunk?.('Finished in the background.');
      call.handlers.onDone?.();
      call.finish();
    });
    await act(() => pending);
    expect(state().chatState[id].messages.at(-1)?.content).toBe('Finished in the background.');
    expect(state().chatState[id].loading).toBe(false);
  });

  it('does not navigate away from the new draft when the old chat gets saved late', async () => {
    const { hook, call, id } = await startNewChat();
    act(() => hook.result.current.startNewConversation());
    act(() => call.handlers.onConversationCreated?.(id));
    expect(replace).not.toHaveBeenCalled();
    call.finish();
  });

  it('can run a second new chat alongside the first', async () => {
    const first = await startNewChat('First');
    act(() => first.hook.result.current.startNewConversation());

    const second = renderHook(() => useChat('new'), { wrapper });
    act(() => {
      void second.result.current.sendMessage('Second');
    });
    await waitFor(() => expect(calls).toHaveLength(2));

    const ids = state().conversations.map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => state().chatState[id].loading)).toBe(true);
    calls.forEach((c) => c.finish());
  });
});

describe('failures and stopping', () => {
  it('removes the sidebar entry if the server never saved the chat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { call, pending } = await startNewChat();
    act(() => call.fail(new Error('Rate limited')));
    await act(() => pending);
    expect(state().conversations).toEqual([]);
    expect(state().chatState.new.error).toBe('Rate limited');
    expect(state().chatState.new.messages.map((m) => m.content)).toEqual(['Explain TCP congestion control']);
  });

  it('Stop aborts only the chat on screen and keeps what was streamed', async () => {
    const { call, id, pending } = await startNewChat();
    act(() => call.handlers.onConversationCreated?.(id));
    act(() => call.handlers.onChunk?.('Partial'));

    const view = renderHook(() => useChat(id), { wrapper });
    act(() => view.result.current.stopGenerating());
    await act(() => pending);

    expect(call.signal.aborted).toBe(true);
    expect(state().chatState[id].messages.at(-1)?.content).toBe('Partial');
    expect(state().conversations.map((c) => c.id)).toEqual([id]);
  });
});

describe('queueing messages while a reply streams', () => {
  async function streamingChat() {
    const started = await startNewChat('First');
    act(() => started.call.handlers.onConversationCreated?.(started.id));
    const view = renderHook(() => useChat(started.id), { wrapper });
    return { ...started, view };
  }
  const sentMessages = () => calls.map((c) => c.request.message);

  it('holds queued messages and sends them one at a time as each reply finishes', async () => {
    const { view, call } = await streamingChat();
    act(() => {
      view.result.current.queueMessage('Second');
      view.result.current.queueMessage('Third');
    });
    expect(view.result.current.queue.map((item) => item.content)).toEqual(['Second', 'Third']);
    expect(calls).toHaveLength(1);

    act(() => call.finish());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(sentMessages()).toEqual(['First', 'Second']);
    expect(view.result.current.queue.map((item) => item.content)).toEqual(['Third']);

    act(() => calls[1].finish());
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(sentMessages()).toEqual(['First', 'Second', 'Third']);
    expect(view.result.current.queue).toEqual([]);
    calls[2].finish();
  });

  it('Steer interrupts the reply, keeps what streamed, and sends the steered message next', async () => {
    const { view, call, id } = await streamingChat();
    act(() => call.handlers.onChunk?.('Partial'));
    act(() => {
      view.result.current.queueMessage('Later');
      view.result.current.queueMessage('Change of plan');
    });
    const steered = view.result.current.queue[1].id;

    act(() => view.result.current.steerQueuedMessage(steered));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(call.signal.aborted).toBe(true);
    expect(sentMessages()).toEqual(['First', 'Change of plan']);
    expect(view.result.current.queue.map((item) => item.content)).toEqual(['Later']);
    const contents = state().chatState[id].messages.map((m) => m.content);
    expect(contents.slice(0, 3)).toEqual(['First', 'Partial', 'Change of plan']);
    calls[1].finish();
  });

  it('Stop pauses the queue, and Send on a paused message sends it', async () => {
    const { view, pending } = await streamingChat();
    act(() => view.result.current.queueMessage('Queued'));
    act(() => view.result.current.stopGenerating());
    await act(() => pending);
    expect(calls).toHaveLength(1);
    expect(view.result.current.queue.map((item) => item.content)).toEqual(['Queued']);

    act(() => view.result.current.steerQueuedMessage(view.result.current.queue[0].id));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(sentMessages()).toEqual(['First', 'Queued']);
    calls[1].finish();
  });

  it('carries queued attachments along', async () => {
    const { view, call } = await streamingChat();
    const file = { documentId: 'd1', name: 'notes.pdf', mimeType: 'application/pdf', size: 10 };
    act(() => view.result.current.queueMessage('See file', [file]));
    act(() => call.finish());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].request.attachments).toEqual([file]);
    calls[1].finish();
  });
});

describe('queue review fixes', () => {
  async function streamingChat() {
    const started = await startNewChat('First');
    act(() => started.call.handlers.onConversationCreated?.(started.id));
    const view = renderHook(() => ({ chat: useChat(started.id), models: useModelSelection() }), { wrapper });
    return { ...started, view };
  }

  it('sends a queued message with the model chosen when it was queued', async () => {
    const { view, call } = await streamingChat();
    act(() => view.result.current.models.setSelectedModel('anthropic/claude-sonnet-5.5'));
    act(() => view.result.current.chat.queueMessage('Queued with Claude'));
    act(() => view.result.current.models.setSelectedModel('google/gemini-4-argon'));
    act(() => call.finish());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].request.selectedModel).toBe('anthropic/claude-sonnet-5.5');
    calls[1].finish();
  });

  it('never sends a message while it is open for editing, and sends the edit afterwards', async () => {
    const { view, call } = await streamingChat();
    act(() => {
      view.result.current.chat.queueMessage('Being edited');
      view.result.current.chat.queueMessage('Ready');
    });
    const edited = view.result.current.chat.queue[0].id;
    act(() => view.result.current.chat.startEditingQueued(edited));
    act(() => call.finish());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].request.message).toBe('Ready');

    act(() => calls[1].finish());
    await waitFor(() => expect(state().chatState[call.request.conversationId!].loading).toBe(false));
    expect(calls).toHaveLength(2);
    act(() => view.result.current.chat.finishEditingQueued(edited, 'Edited text'));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].request.message).toBe('Edited text');
    calls[2].finish();
  });

  it('drops the queue when its chat is deleted', async () => {
    const { view, call, id, pending } = await streamingChat();
    act(() => view.result.current.chat.queueMessage('Orphan'));
    await act(() => state().deleteConversation(id));
    expect(state().queues[id]).toBeUndefined();
    act(() => call.finish());
    await act(() => pending);
    expect(calls).toHaveLength(1);
  });

  it('a held queue stays held after the user sends something else', async () => {
    const { view, pending } = await streamingChat();
    act(() => view.result.current.chat.queueMessage('Held'));
    act(() => view.result.current.chat.stopGenerating());
    await act(() => pending);
    expect(view.result.current.chat.queuePaused).toBe(true);

    act(() => {
      void view.result.current.chat.sendMessage('Typed after Stop');
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    act(() => calls[1].finish());
    await waitFor(() => expect(view.result.current.chat.loading).toBe(false));
    expect(calls).toHaveLength(2);
    expect(view.result.current.chat.queue.map((item) => item.content)).toEqual(['Held']);
  });

  it('keeps queued messages, held, when a new chat fails before it was saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { id, call, pending } = await startNewChat('First');
    const view = renderHook(() => useChat(id), { wrapper });
    act(() => view.result.current.queueMessage('Still wanted'));
    act(() => call.fail(new Error('Rate limited')));
    await act(() => pending);

    expect(state().queues[id]).toBeUndefined();
    expect(state().queues.new.map((item) => item.content)).toEqual(['Still wanted']);
    expect(state().queuesPaused.new).toBe(true);
  });

  it('leaves a message queued if it cannot be sent yet', async () => {
    const { view, pending } = await streamingChat();
    act(() => view.result.current.chat.queueMessage('Keep me'));
    act(() => view.result.current.chat.stopGenerating());
    await act(() => pending);
    useAppStore.setState({ user: null });
    act(() => view.result.current.chat.steerQueuedMessage(view.result.current.chat.queue[0].id));
    expect(calls).toHaveLength(1);
    expect(view.result.current.chat.queue.map((item) => item.content)).toEqual(['Keep me']);
  });
});
