/**
 * The live transcript of an MCP turn: what the streamed tool events leave on
 * the assistant message, and how the user's decision travels to the server.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatRequest, Message } from '@/src/types/chat.types';
import type { ChatStreamHandlers } from '@/src/services/api';

const decide = vi.hoisted(() => vi.fn());
const skillTagsIn = vi.hoisted(() => vi.fn(() => [] as { id: string; name: string }[]));
vi.mock('@/src/lib/client/skills', () => ({ skillTagsIn }));
vi.mock('@/src/lib/client/mcp', () => ({ submitToolDecision: decide }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/src/services/apiOptimizer', () => ({ cacheInvalidators: { conversationList: vi.fn() } }));

interface Call {
  request: ChatRequest;
  handlers: ChatStreamHandlers;
  finish: () => void;
}
const calls: Call[] = [];
vi.mock('@/src/services/api', () => ({
  ApiService: {
    sendMessage: (request: ChatRequest, handlers: ChatStreamHandlers, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        calls.push({ request, handlers, finish: resolve });
      }),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(async () => {}),
  },
}));

const { useChat } = await import('@/src/hooks/useChat');
const { ModelSelectionProvider } = await import('@/src/context/ModelSelectionContext');
const { useAppStore } = await import('@/src/store/rootStore');
const { default: ToolCallCard } = await import('@/src/components/chat/messages/AIMessage/ToolCallCard');

const wrapper = ({ children }: { children: React.ReactNode }) => <ModelSelectionProvider>{children}</ModelSelectionProvider>;
const lastMessage = (): Message | undefined =>
  useAppStore.getState().chatState[calls[0].request.conversationId!]?.messages.at(-1);

const approval = {
  approvalId: 'ap_123456', callId: 'call_1', name: 'cloudflare-docs_search', toolId: 'search_cloudflare_documentation',
  connectionId: 'c1', arguments: { query: 'workers' }, round: 1, expiresAt: Date.now() + 120_000,
};
const completed = {
  callId: 'call_1', name: 'cloudflare-docs_search', toolId: 'search_cloudflare_documentation', connectionId: 'c1',
  arguments: '{"query":"workers"}', status: 'completed', approval: 'approved', result: 'Workers run on the edge.', truncated: false,
} as const;

async function startTurn() {
  const hook = renderHook(() => useChat('c-current'), { wrapper });
  await waitFor(() => expect(hook.result.current.sendMessage).toBeTypeOf('function'));
  act(() => {
    void hook.result.current.sendMessage('Search the docs');
  });
  await waitFor(() => expect(calls).toHaveLength(1));
  return { hook, handlers: calls[0].handlers };
}

beforeEach(() => {
  skillTagsIn.mockReturnValue([]);
  calls.length = 0;
  decide.mockReset();
  window.history.replaceState(null, '', '/c-current');
  useAppStore.setState({
    user: { id: 'u1', name: 'T', email: 't@example.com', avatarUrl: null },
    conversations: [],
    chatState: { 'c-current': { messages: [{ id: 'q1', role: 'user', content: 'Search the docs' }], loading: false, replyComplete: false, councilProgress: [] } },
    queues: {},
    queuesPaused: {},
    currentConversationId: 'c-current',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamed tool events land on the assistant message', () => {
  it('holds an approval request, runs the call and records the result', async () => {
    const { handlers } = await startTurn();
    act(() => handlers.onChunk?.('Let me '));
    act(() => handlers.onToolApprovalRequest?.(approval));
    expect(lastMessage()?.toolCall).toMatchObject({ callId: 'call_1', name: 'cloudflare-docs_search', state: 'pending', approvalId: 'ap_123456' });
    expect(lastMessage()?.toolCalls).toBeUndefined();

    act(() => handlers.onToolCallStarted?.({ callId: 'call_1', name: 'cloudflare-docs_search' }));
    expect(lastMessage()?.toolCall).toMatchObject({ state: 'running' });

    act(() => handlers.onToolCallResult?.(completed));
    act(() => handlers.onChunk?.('look: workers run at the edge.'));
    expect(lastMessage()?.toolCall).toBeUndefined();
    expect(lastMessage()?.toolCalls).toEqual([completed]);
  });

  it('notes a discovery failure and a stopped loop without hiding the text', async () => {
    const { handlers } = await startTurn();
    act(() => handlers.onToolDiscoveryFailed?.({ connectionId: 'c2', error: 'The server refused the token.' }));
    act(() => handlers.onToolLoopStopped?.({ limit: 'rounds', message: 'The tool round limit was reached.' }));
    act(() => handlers.onChunk?.('Here is what I have.'));
    expect(lastMessage()?.toolNotices).toEqual([
      "A connection's tools could not be loaded: The server refused the token.",
      'The tool round limit was reached.',
    ]);
    await waitFor(() => expect(lastMessage()?.content).toContain('Here is what I have.'));
  });

  it('sends the decision once, tied to the conversation, and marks failures', async () => {
    decide.mockResolvedValueOnce({ ok: true, decision: 'approved' });
    const { hook, handlers } = await startTurn();
    act(() => handlers.onToolApprovalRequest?.(approval));
    await act(async () => {
      await hook.result.current.decideToolCall('approved');
    });
    expect(decide).toHaveBeenCalledWith({ approvalId: 'ap_123456', conversationId: 'c-current', decision: 'approved' });
    // The result event closes the row; the click itself never replays the approval.
    await act(async () => {
      await hook.result.current.decideToolCall('approved');
    });
    expect(decide).toHaveBeenCalledTimes(1);

    decide.mockRejectedValueOnce(new Error('That approval was already decided or has ended.'));
    act(() => handlers.onToolApprovalRequest?.(approval));
    await act(async () => {
      await hook.result.current.decideToolCall('denied');
    });
    expect(lastMessage()?.toolCall).toMatchObject({ state: 'lost', error: 'That approval was already decided or has ended.' });
  });
});

describe('the tool card', () => {
  it('labels every recorded state and opens the result', async () => {
    const user = userEvent.setup();
    render(
      <ToolCallCard
        calls={[
          { ...completed, result: 'Workers run on the edge.' },
          { ...completed, callId: 'call_2', status: 'denied', approval: 'denied', result: 'The user denied this call.' },
          { ...completed, callId: 'call_3', status: 'failed', approval: 'approved', result: '', error: 'The MCP server timed out.', truncated: true },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Recorded tool calls' });
    expect(within(list).getByLabelText('Tool call cloudflare-docs_search: Completed')).toBeInTheDocument();
    expect(within(list).getByText('Denied')).toBeInTheDocument();
    expect(within(list).getByText('Failed')).toBeInTheDocument();
    expect(within(list).getByText('result shortened')).toBeInTheDocument();
    await user.click(within(list).getAllByText('Result sent to the model')[0]);
    expect(within(list).getByText('Workers run on the edge.')).toBeInTheDocument();
  });

  it('asks for approval with the exact arguments and routes both buttons', async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(<ToolCallCard live={{ callId: 'call_1', name: 'github_get_issue', state: 'pending', approvalId: 'ap_1', arguments: { repo: 'a/b', issue: 7 } }} onDecision={onDecision} />);
    const card = screen.getByRole('region', { name: 'Tool calls' });
    expect(within(card).getByText('Needs your approval')).toBeInTheDocument();
    expect(within(card).getByText(/"repo": "a\/b"/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Approve github_get_issue' }));
    expect(onDecision).toHaveBeenLastCalledWith('approved');
    await user.click(within(card).getByRole('button', { name: 'Deny github_get_issue' }));
    expect(onDecision).toHaveBeenLastCalledWith('denied');
  });

  it('shows running, deciding and lost states', () => {
    const { rerender } = render(<ToolCallCard live={{ callId: 'a', name: 'tool_a', state: 'running' }} />);
    expect(screen.getByText('Running…')).toBeInTheDocument();
    rerender(<ToolCallCard live={{ callId: 'a', name: 'tool_a', state: 'deciding' }} />);
    expect(screen.getByText('Sending your decision…')).toBeInTheDocument();
    rerender(<ToolCallCard live={{ callId: 'a', name: 'tool_a', state: 'lost', error: 'That approval has expired.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('That approval has expired.');
  });

  it('renders nothing without any tool activity', () => {
    const { container } = render(<ToolCallCard calls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
