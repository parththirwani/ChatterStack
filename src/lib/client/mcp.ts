'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { McpConnectionView, McpConnectionsResponse } from '@/src/types/mcp.types';

/** Fired after any change to the user's connections, so every list refreshes. */
export const MCP_CONNECTIONS_CHANGED_EVENT = 'chatterstack:mcp-connections-changed';

export class McpApiError extends Error {
  constructor(message: string, readonly status: number, readonly field?: string) {
    super(message);
    this.name = 'McpApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new McpApiError(
      body.error ?? body.message ?? 'Something went wrong. Try again.',
      response.status,
      body.field ?? undefined,
    );
  }
  return body as T;
}

const changed = () => window.dispatchEvent(new Event(MCP_CONNECTIONS_CHANGED_EVENT));
const withChange = async <T,>(work: Promise<T>) => {
  const result = await work;
  changed();
  return result;
};

/**
 * Fold a fresh server-side view of one connection into the shared list before
 * the general refresh lands, so switches, counts and the context meter move on
 * the same frame the write was accepted.
 */
function mergeConnection(connection: McpConnectionView) {
  if (!state.connections.some((held) => held.id === connection.id)) return;
  setState({ connections: state.connections.map((held) => (held.id === connection.id ? connection : held)) });
}

export interface CreateMcpConnectionInput {
  name: string;
  url?: string;
  catalogId?: string;
  token?: string | null;
}

export interface UpdateMcpConnectionInput {
  name?: string;
  token?: string | null;
  clearToken?: boolean;
  enabled?: boolean;
  toolEnabled?: Record<string, boolean>;
  reviewTools?: boolean;
}

export const createMcpConnection = (input: CreateMcpConnectionInput) =>
  withChange(request<{ connection: McpConnectionView }>('/api/mcp/connections', { method: 'POST', body: JSON.stringify(input) }).then((body) => body.connection));

export const updateMcpConnection = async (id: string, patch: UpdateMcpConnectionInput) => {
  const body = await request<{ connection: McpConnectionView }>(`/api/mcp/connections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  mergeConnection(body.connection);
  changed();
  return body;
};

export const deleteMcpConnection = (id: string) =>
  withChange(request<void>(`/api/mcp/connections/${id}`, { method: 'DELETE' }));

export interface McpTestResult {
  connection: McpConnectionView;
  ok: boolean;
  error?: string;
}

/** Discovers tools and stores what was found; a failure comes back as `ok: false`. */
export const testMcpConnection = async (id: string) => {
  const result = await request<McpTestResult>(`/api/mcp/connections/${id}/test`, { method: 'POST' });
  mergeConnection(result.connection);
  changed();
  return result;
};

/**
 * Spends one pending approval. The id is single use, so a second click (or a
 * replay from another tab) answers 404 and the call simply stays undecided.
 */
export const submitToolDecision = (input: { approvalId: string; conversationId?: string; decision: 'approved' | 'denied' }) =>
  request<{ ok: true; decision: string }>('/api/mcp/tool-approvals', { method: 'POST', body: JSON.stringify(input) });

// One shared list for the Connections page (and later the composer), loaded
// once per session and refreshed whenever a connection changes.
interface ConnectionsState { connections: McpConnectionView[]; limit: number; loading: boolean; error: string }
let state: ConnectionsState = { connections: [], limit: 0, loading: true, error: '' };
// The user the list belongs to, so a different sign-in never sees it.
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<ConnectionsState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

// Only the newest request's answer is kept, so a list fetched before a later
// change never replaces one fetched after it. Changing user bumps it too.
let latestRequest = 0;
let latestRefresh: Promise<void> = Promise.resolve();

export function refreshMcpConnections() {
  const requested = ++latestRequest;
  latestRefresh = request<McpConnectionsResponse>('/api/mcp/connections')
    .then((body) => {
      if (requested !== latestRequest) return;
      setState({ connections: body.connections, limit: body.limit, loading: false, error: '' });
    })
    .catch((error: Error) => {
      if (requested !== latestRequest) return;
      setState({ loading: false, error: error.message });
    });
  return latestRefresh;
}

/** Starts loading `userId`'s list unless it's the one already held. */
function loadConnectionsFor(userId: string) {
  if (loadedFor === userId) return;
  loadedFor = userId;
  latestRequest += 1;
  setState({ connections: [], limit: 0, loading: true, error: '' });
  void refreshMcpConnections();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let watchers = 0;
const onChanged = () => void refreshMcpConnections();

const SERVER_STATE: ConnectionsState = { connections: [], limit: 0, loading: true, error: '' };

/** The signed-in user's MCP connections. Pass no id (or 'guest') when signed out. */
export function useMcpConnections(userId?: string | null) {
  const enabled = !!userId && userId !== 'guest';
  const snapshot = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);

  useEffect(() => {
    if (!enabled || !userId) return;
    loadConnectionsFor(userId);
    // One refresh per change, however many components use the list.
    if (watchers++ === 0) window.addEventListener(MCP_CONNECTIONS_CHANGED_EVENT, onChanged);
    return () => {
      if (--watchers === 0) window.removeEventListener(MCP_CONNECTIONS_CHANGED_EVENT, onChanged);
    };
  }, [enabled, userId]);

  const refresh = useCallback(() => refreshMcpConnections(), []);
  return enabled ? { ...snapshot, refresh } : { connections: [], limit: 0, loading: false, error: '', refresh };
}

/** Test hook: forget the cached list. */
export function resetMcpConnectionsCache() {
  state = { connections: [], limit: 0, loading: true, error: '' };
  loadedFor = null;
  latestRequest += 1;
  latestRefresh = Promise.resolve();
}
