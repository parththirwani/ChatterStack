/**
 * The only place that talks to a remote MCP server. Everything the server
 * returns - names, descriptions, schemas, results - is untrusted input, so the
 * tool list is capped, every schema is size-checked and required to be an object
 * schema, and names are rewritten into unique OpenRouter-safe function names with
 * a reverse map for execution. Requests go through the SSRF-guarded fetch, every
 * call has a deadline, and the transport is always closed. Errors are normalized
 * into `McpError` with the bearer token removed, so nothing sensitive can reach a
 * log, a trace or an API response.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError as SdkMcpError } from '@modelcontextprotocol/sdk/types.js';
import { McpUrlError, assertSafeMcpUrl, createSafeFetch, type AddressResolver } from './mcp-url';
import { redactedErrorText, redactSecrets } from './mcp-redact';
import { countTokens } from '@/src/lib/tokens';
import type { McpErrorCode } from '@/src/types/mcp.types';

export const MCP_LIMITS = {
  maxTools: 32,
  maxSchemaBytes: 8_192,
  maxDescriptionChars: 1_500,
  connectTimeoutMs: 10_000,
  listTimeoutMs: 15_000,
  callTimeoutMs: 30_000,
  /** Per HTTP response, so a hostile server cannot exhaust the server. */
  maxResponseBytes: 1_048_576,
  /** Raw text collected from one tool result before the chat loop truncates it. */
  maxResultChars: 200_000,
} as const;

// The code list is a shared, credential-free shape: the browser maps these to the
// wording it shows, so it lives with the other browser-safe MCP types.
export type { McpErrorCode } from '@/src/types/mcp.types';

export class McpError extends Error {
  readonly code: McpErrorCode;
  /** The HTTP status the Connections UI should see for this failure. */
  readonly status: number;

  constructor(code: McpErrorCode, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'McpError';
  }
}

export interface McpEndpoint {
  url: string;
  /** The user's bearer token in plain text. Never leaves this module. */
  token?: string | null;
}

export interface McpGuardOptions {
  resolveAddresses?: AddressResolver;
  /** Origins the operator explicitly trusts, e.g. a local fixture in tests. */
  allowedOrigins?: readonly string[];
}

export interface McpCallOptions extends McpGuardOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** A tool exactly as the server described it, after size screening. */
export interface McpToolInfo {
  /** The server's own tool name, used for execution. */
  name: string;
  description: string;
  readOnly: boolean;
  inputSchema: unknown;
  schemaBytes: number;
  /**
   * Estimated model-facing token cost, persisted next to the stored tool entry
   * at discovery. Absent on rows stored before estimates existed.
   */
  estTokens?: number | null;
}

/** A discovered tool plus the name the model is allowed to see. */
export interface NormalizedMcpTool extends McpToolInfo {
  /** Unique OpenRouter-safe function name. */
  fnName: string;
}

/**
 * Estimated tokens the model spends carrying one tool definition around: the
 * model-facing function name, the description and the serialized input schema,
 * counted with the same tokenizer the chat budget uses. An estimate for display
 * and budgeting only - never a billed number.
 */
export function estimateToolTokens(tool: Pick<McpToolInfo, 'name' | 'description' | 'inputSchema'> & { fnName?: string }): number {
  const facingName = tool.fnName ?? tool.name;
  let serialized: string;
  try {
    serialized = JSON.stringify(tool.inputSchema ?? {});
  } catch {
    serialized = '{}';
  }
  return countTokens(`${facingName}\n${tool.description}\n${serialized}`);
}

const slug = (value: string, max: number): string => {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'tool').slice(0, max);
};

/**
 * Rewrites server tool names into unique OpenRouter-safe function names. The
 * reverse map is what execution uses, so a server that hands back
 * `get_weather` and `get-weather` cannot address the same function twice.
 */
export function normalizeToolNames(prefix: string, tools: readonly McpToolInfo[]): NormalizedMcpTool[] {
  const owner = slug(prefix, 20);
  const taken = new Set<string>();
  return tools.map((tool) => {
    const base = `${owner}__${slug(tool.name, 64 - owner.length - 2)}`;
    let fnName = base;
    let suffix = 2;
    while (taken.has(fnName)) fnName = `${base.slice(0, 58)}_${suffix++}`;
    taken.add(fnName);
    return { ...tool, fnName };
  });
}

/** The server tool name behind a normalized function name, or null. */
export function reverseToolName(tools: readonly NormalizedMcpTool[], fnName: string): string | null {
  return tools.find((tool) => tool.fnName === fnName)?.name ?? null;
}

function screenTool(raw: unknown): McpToolInfo {
  if (typeof raw !== 'object' || raw === null) throw new McpError('protocol', 'The MCP server sent a malformed tool.');
  const tool = raw as { name?: unknown; description?: unknown; inputSchema?: unknown; annotations?: unknown };
  if (typeof tool.name !== 'string' || !tool.name.trim()) throw new McpError('protocol', 'The MCP server sent a tool without a name.');
  const schema = tool.inputSchema ?? { type: 'object', properties: {} };
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema) || (schema as { type?: unknown }).type !== 'object') {
    throw new McpError('unsupported_schema', `"${tool.name}" does not use an object input schema, so it cannot be offered to the model.`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    throw new McpError('unsupported_schema', `"${tool.name}" sent a schema that could not be read.`);
  }
  if (serialized.length > MCP_LIMITS.maxSchemaBytes) {
    throw new McpError('oversized_schema', `"${tool.name}" sent a schema larger than ${(MCP_LIMITS.maxSchemaBytes / 1024).toFixed(0)} KB, so this connection was rejected.`);
  }
  const annotations = (tool.annotations ?? {}) as { readOnlyHint?: unknown };
  return {
    name: tool.name.trim(),
    description: redactSecrets(typeof tool.description === 'string' ? tool.description : '').slice(0, MCP_LIMITS.maxDescriptionChars),
    readOnly: annotations.readOnlyHint === true,
    inputSchema: schema,
    schemaBytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** Turns any SDK, transport or guard failure into one normalized, secret-free error. */
export function normalizeMcpError(error: unknown, endpoint: McpEndpoint): McpError {
  if (error instanceof McpError) return error;
  const token = endpoint.token ?? null;
  if (error instanceof McpUrlError) {
    const code: McpErrorCode = error.code === 'blocked_address' || error.code === 'blocked_host' ? 'blocked_address'
      : error.code === 'response_too_large' ? 'response_too_large'
      : error.code === 'dns_failed' ? 'unreachable'
      : 'invalid_url';
    return new McpError(code, redactSecrets(error.message, [token]), error.status);
  }
  if (isAbort(error)) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return new McpError(timedOut ? 'timeout' : 'cancelled', timedOut ? 'The MCP server did not answer in time.' : 'The MCP request was cancelled.', timedOut ? 504 : 499);
  }
  if (error instanceof SdkMcpError) {
    const message = redactSecrets(error.message, [token]);
    if (error.code === -32001) return new McpError('timeout', 'The MCP server did not answer in time.', 504);
    return new McpError('protocol', message, 502);
  }
  const text = redactedErrorText(error, [token]);
  if (/\b401\b|unauthorized/i.test(text)) return new McpError('unauthorized', 'The MCP server rejected the token.', 401);
  if (/\b403\b|forbidden/i.test(text)) return new McpError('unauthorized', 'The MCP server refused this token for this server.', 403);
  if (/\b404\b|not found/i.test(text)) return new McpError('not_found', 'No MCP endpoint is answering at that URL.', 404);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(text)) {
    return new McpError('unreachable', 'The MCP server could not be reached.', 502);
  }
  return new McpError('unknown', text, 502);
}

async function withClient<T>(endpoint: McpEndpoint, options: McpCallOptions, run: (client: Client) => Promise<T>, timeoutMs: number): Promise<T> {
  const secrets = [endpoint.token ?? null];
  const transportFetch = createSafeFetch({
    maxResponseBytes: MCP_LIMITS.maxResponseBytes,
    resolveAddresses: options.resolveAddresses,
    allowedOrigins: options.allowedOrigins,
  });
  const target = assertSafeMcpUrl(endpoint.url, { allowedOrigins: options.allowedOrigins });
  const headers: Record<string, string> = { Accept: 'application/json, text/event-stream' };
  if (endpoint.token) headers.Authorization = `Bearer ${endpoint.token}`;
  const transport = new StreamableHTTPClientTransport(target, {
    fetch: transportFetch,
    redirectPolicy: 'same-origin',
    requestInit: { headers },
  });
  const client = new Client({ name: 'chatterstack', version: '0.1.0' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpError('timeout', 'The MCP server did not answer in time.', 504)), timeoutMs);
  });
  const close = async () => {
    await Promise.resolve(client.close()).catch(() => {});
    await Promise.resolve(transport.close()).catch(() => {});
  };
  const work = (async () => {
    await client.connect(transport);
    return run(client);
  })();
  // Never leave the rejected sibling unhandled.
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    if (options.signal?.aborted) throw new McpError('cancelled', 'The MCP request was cancelled.', 499);
    throw normalizeMcpError(error, { ...endpoint, token: secrets[0] });
  } finally {
    if (timer) clearTimeout(timer);
    await close();
    await transportFetch.close();
  }
}

/** Connects, lists tools, screens every schema, and closes the connection. */
export async function discoverMcpTools(endpoint: McpEndpoint, options: McpCallOptions = {}): Promise<McpToolInfo[]> {
  const tools = await withClient(endpoint, options, async (client) => {
    try {
      const result = await client.listTools(undefined, { signal: options.signal, timeout: options.timeoutMs ?? MCP_LIMITS.listTimeoutMs });
      return result.tools;
    } catch (error) {
      // A server without any tools may not advertise the method at all.
      if (error instanceof SdkMcpError && /-32601|not found/i.test(error.message)) return [];
      throw error;
    }
  }, options.timeoutMs ?? MCP_LIMITS.listTimeoutMs);
  if (tools.length > MCP_LIMITS.maxTools) {
    throw new McpError('too_many_tools', `This MCP server offers ${tools.length} tools, which is more than the ${MCP_LIMITS.maxTools} allowed per connection.`);
  }
  return tools.map(screenTool);
}

/** Discovers tools and hands back the normalized names the model will see. */
export async function discoverNormalizedTools(endpoint: McpEndpoint, prefix: string, options: McpCallOptions = {}): Promise<NormalizedMcpTool[]> {
  const tools = await discoverMcpTools(endpoint, options);
  return normalizeToolNames(prefix, tools);
}

/**
 * Runs one approved tool call and returns its text result. Arguments come from
 * the model and are still untrusted; the server validates them itself.
 */
export async function callMcpTool(endpoint: McpEndpoint, toolName: string, args: Record<string, unknown>, options: McpCallOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? MCP_LIMITS.callTimeoutMs;
  const result = await withClient(endpoint, { ...options, signal: options.signal }, async (client) =>
    client.callTool({ name: toolName, arguments: args }, undefined, { signal: options.signal, timeout: timeoutMs })
  , timeoutMs);
  const payload = result as { content?: unknown; isError?: unknown };
  const text = Array.isArray(payload.content)
    ? payload.content
      .map((part) => {
        const item = part as { type?: unknown; text?: unknown };
        return item?.type === 'text' && typeof item.text === 'string' ? item.text : '';
      })
      .filter(Boolean)
      .join('\n')
    : '';
  if (payload.isError === true) {
    throw new McpError('tool_failed', redactSecrets(text || 'The MCP tool reported an error.', [endpoint.token ?? null]), 200);
  }
  if (!text && !Array.isArray(payload.content)) throw new McpError('protocol', 'The MCP tool returned no readable result.', 502);
  return text.length > MCP_LIMITS.maxResultChars ? `${text.slice(0, MCP_LIMITS.maxResultChars)}\n[truncated]` : text;
}
