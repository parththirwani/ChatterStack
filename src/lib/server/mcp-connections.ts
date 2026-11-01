/**
 * User-scoped MCP connections: creation, quota, encrypted bearer tokens, the
 * discovered tool list and the per-tool allowlist. Every query is filtered by the
 * session user id, and no function here returns a credential - `publicConnection`
 * strips the ciphertext and reports only whether a token is stored.
 */
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/src/lib/prisma';
import { findMcpCatalogEntry, type McpCatalogEntry } from '@/src/config/mcp-catalog';
import { MCP_LIMITS, McpError, discoverMcpTools, normalizeToolNames, type McpToolInfo, type NormalizedMcpTool } from './mcp-client';
import { assertSafeMcpUrl, type AddressResolver } from './mcp-url';
import { credentialKeyConfigured, decryptCredential, encryptCredential } from './mcp-crypto';
import { redactedErrorText } from './mcp-redact';

export const MAX_MCP_CONNECTIONS_PER_USER = 10;
export const MAX_MCP_NAME = 60;

export class McpConnectionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'McpConnectionError';
  }
}

export interface McpConnectionRow {
  id: string;
  userId: string;
  name: string;
  catalogId: string | null;
  url: string;
  transport: string;
  authMode: string;
  credential: string | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
  tools: unknown;
  toolsDigest: string | null;
  reviewedDigest: string | null;
  toolEnabled: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// The browser-safe views live with the other shared shapes, so the connections
// UI and this service can never drift apart.
export type { McpConnectionStatus, McpConnectionsResponse, McpToolView } from '@/src/types/mcp.types';
import type { McpConnectionView } from '@/src/types/mcp.types';

export interface CreateConnectionInput {
  name: string;
  url?: string;
  catalogId?: string;
  token?: string | null;
}

export interface UpdateConnectionInput {
  name?: string;
  enabled?: boolean;
  token?: string | null;
  clearToken?: boolean;
  toolEnabled?: Record<string, boolean>;
  reviewTools?: boolean;
}

export interface ConnectionGuard {
  resolveAddresses?: AddressResolver;
  allowedOrigins?: readonly string[];
}

const storedTools = (row: McpConnectionRow): McpToolInfo[] =>
  Array.isArray(row.tools) ? (row.tools as McpToolInfo[]).filter((tool) => tool && typeof tool.name === 'string') : [];

const enabledMap = (row: McpConnectionRow): Record<string, boolean> => {
  const raw = row.toolEnabled;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, value]) => value === true).map(([key]) => [key, true]));
};

export function toolDigest(tools: readonly McpToolInfo[]): string {
  const shape = tools.map((tool) => [tool.name, tool.schemaBytes, tool.description]).sort();
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 32);
}

/** The tool list plus the normalized function names the model would see. */
export function normalizedTools(row: McpConnectionRow): NormalizedMcpTool[] {
  return normalizeToolNames(row.name, storedTools(row));
}

export function publicConnection(row: McpConnectionRow): McpConnectionView {
  const tools = storedTools(row);
  const allowlist = enabledMap(row);
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    host: new URL(row.url).host,
    catalogId: row.catalogId,
    transport: row.transport,
    authMode: row.authMode === 'bearer' ? 'bearer' : 'none',
    hasCredential: Boolean(row.credential),
    enabled: row.enabled,
    status: row.status === 'connected' || row.status === 'error' ? row.status : 'untested',
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    tools: tools.map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description,
      readOnly: tool.readOnly,
      schemaBytes: tool.schemaBytes,
      enabled: allowlist[tool.name] === true,
    })),
    toolCount: tools.length,
    needsReview: (row.toolsDigest ?? null) !== (row.reviewedDigest ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const catalogFor = (catalogId?: string): McpCatalogEntry | undefined => (catalogId ? findMcpCatalogEntry(catalogId) : undefined);

/** The endpoint a row points at, with the token decrypted for this call only. */
export function endpointFor(row: McpConnectionRow): { url: string; token: string | null } {
  return { url: row.url, token: row.credential ? decryptCredential(row.userId, row.id, row.credential) : null };
}

function resolveTarget(input: CreateConnectionInput, guard: ConnectionGuard): { url: string; catalogId: string | null; name: string } {
  const catalog = catalogFor(input.catalogId);
  if (input.catalogId && !catalog) throw new McpConnectionError('That catalog entry does not exist.', 400);
  const url = catalog ? catalog.url : input.url ?? '';
  if (catalog && input.url && input.url.trim() !== catalog.url) {
    throw new McpConnectionError('A catalog connection keeps the catalog URL.', 400);
  }
  let parsed: URL;
  try {
    parsed = assertSafeMcpUrl(url, { allowedOrigins: guard.allowedOrigins });
  } catch (error) {
    if (error instanceof Error) throw new McpConnectionError(error.message, 400);
    throw error;
  }
  return { url: parsed.toString(), catalogId: catalog?.id ?? null, name: input.name.trim() };
}

export async function listConnections(userId: string): Promise<McpConnectionView[]> {
  const rows = (await prisma.mcpConnection.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })) as unknown as McpConnectionRow[];
  return rows.map(publicConnection);
}

export async function getConnection(userId: string, id: string): Promise<McpConnectionRow | null> {
  return (await prisma.mcpConnection.findFirst({ where: { id, userId } })) as unknown as McpConnectionRow | null;
}

export async function createConnection(userId: string, input: CreateConnectionInput, guard: ConnectionGuard = {}): Promise<McpConnectionView> {
  const target = resolveTarget(input, guard);
  const needsToken = Boolean(input.token && input.token.trim());
  if (needsToken && !credentialKeyConfigured()) {
    throw new McpConnectionError('This deployment cannot store MCP tokens yet: set MCP_CREDENTIAL_KEY.', 503);
  }
  const used = await prisma.mcpConnection.count({ where: { userId } });
  if (used >= MAX_MCP_CONNECTIONS_PER_USER) {
    throw new McpConnectionError(`You can connect up to ${MAX_MCP_CONNECTIONS_PER_USER} MCP servers. Delete one first.`, 409);
  }
  const id = randomUUID();
  const credential = needsToken ? encryptCredential(userId, id, input.token) : null;
  let row: McpConnectionRow;
  try {
    row = (await prisma.mcpConnection.create({
      data: {
        id,
        userId,
        name: target.name.slice(0, MAX_MCP_NAME),
        catalogId: target.catalogId,
        url: target.url,
        transport: 'streamable_http',
        authMode: needsToken ? 'bearer' : catalogFor(target.catalogId ?? undefined)?.auth === 'bearer' ? 'bearer' : 'none',
        credential,
        enabled: false,
        status: 'untested',
        tools: [],
        toolEnabled: {},
      },
    })) as unknown as McpConnectionRow;
  } catch (error) {
    if (isUniqueViolation(error)) throw new McpConnectionError('You already have a connection with that name.', 409);
    throw error;
  }
  return publicConnection(row);
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

export async function updateConnection(userId: string, id: string, input: UpdateConnectionInput): Promise<McpConnectionView | null> {
  const row = await getConnection(userId, id);
  if (!row) return null;
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new McpConnectionError('A connection needs a name.', 400);
    data.name = name.slice(0, MAX_MCP_NAME);
    // Function names are derived from the connection name, so old choices are void.
    data.reviewedDigest = null;
  }

  if (input.token !== undefined || input.clearToken) {
    const token = input.clearToken ? null : input.token?.trim() ?? '';
    if (token && !credentialKeyConfigured()) {
      throw new McpConnectionError('This deployment cannot store MCP tokens yet: set MCP_CREDENTIAL_KEY.', 503);
    }
    data.credential = token ? encryptCredential(userId, id, token) : null;
    data.authMode = token ? 'bearer' : 'none';
  }

  if (input.toolEnabled !== undefined) {
    const tools = storedTools(row).map((tool) => tool.name);
    const entries = Object.entries(input.toolEnabled);
    if (entries.length > MCP_LIMITS.maxTools) throw new McpConnectionError('Too many tools were enabled at once.', 400);
    for (const [key, value] of entries) {
      if (typeof value !== 'boolean') throw new McpConnectionError('Tool switches must be on or off.', 400);
      if (!tools.includes(key)) throw new McpConnectionError(`"${key}" is not a tool on this connection. Test the connection first.`, 400);
    }
    const next = { ...enabledMap(row), ...input.toolEnabled };
    data.toolEnabled = Object.fromEntries(Object.entries(next).filter(([, value]) => value));
  }

  if (input.reviewTools) {
    if (!row.toolsDigest) throw new McpConnectionError('Test the connection before reviewing its tools.', 409);
    data.reviewedDigest = row.toolsDigest;
  }

  if (input.enabled !== undefined) {
    if (input.enabled && (row.toolsDigest ?? null) !== (input.reviewTools ? row.toolsDigest : (row.reviewedDigest ?? null))) {
      throw new McpConnectionError('Review the tool list before turning this connection on.', 409);
    }
    data.enabled = input.enabled;
    // Turning a connection off also drops its tool allowlist, so a later switch
    // back on starts from nothing selected.
    if (!input.enabled) data.toolEnabled = {};
  }

  if (Object.keys(data).length === 0) return publicConnection(row);
  const updated = await write(userId, id, data);
  if (!updated) return null;
  return publicConnection(updated);
}

/** Writes through a user scoped filter, so a row can never be touched by another session. */
async function write(userId: string, id: string, data: Record<string, unknown>): Promise<McpConnectionRow | null> {
  try {
    await prisma.mcpConnection.updateMany({ where: { id, userId }, data });
  } catch (error) {
    if (isUniqueViolation(error)) throw new McpConnectionError('You already have a connection with that name.', 409);
    throw error;
  }
  return getConnection(userId, id);
}

export async function deleteConnection(userId: string, id: string): Promise<boolean> {
  const result = await prisma.mcpConnection.deleteMany({ where: { id, userId } });
  return (result?.count ?? 0) > 0;
}

export interface TestResult {
  connection: McpConnectionView;
  ok: boolean;
  error?: string;
}

/**
 * Connects, lists tools, screens every schema and stores what was found. A
 * failure is saved as a visible connection error rather than thrown, because the
 * UI has to show which connection is broken and why.
 */
export async function testConnection(userId: string, id: string, guard: ConnectionGuard = {}): Promise<TestResult | null> {
  const row = await getConnection(userId, id);
  if (!row) return null;
  const secrets: (string | null)[] = [];
  try {
    const endpoint = endpointFor(row);
    secrets.push(endpoint.token);
    const tools = await discoverMcpTools(endpoint, {
      resolveAddresses: guard.resolveAddresses,
      allowedOrigins: guard.allowedOrigins,
    });
    const digest = toolDigest(tools);
    const allowlist = enabledMap(row);
    const kept = Object.fromEntries(Object.entries(allowlist).filter(([key]) => tools.some((tool) => tool.name === key)));
    const updated = await write(userId, id, {
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, readOnly: tool.readOnly, schemaBytes: tool.schemaBytes })),
      toolsDigest: digest,
      reviewedDigest: row.toolsDigest === digest ? row.reviewedDigest : null,
      toolEnabled: kept,
      status: 'connected',
      lastError: null,
      lastCheckedAt: new Date(),
    });
    if (!updated) return null;
    return { connection: publicConnection(updated), ok: true };
  } catch (error) {
    const message = error instanceof McpError ? redactedErrorText(error.message, secrets) : redactedErrorText(error, secrets);
    const updated = await write(userId, id, {
      status: 'error',
      lastError: message,
      lastCheckedAt: new Date(),
      tools: [],
      toolsDigest: null,
      reviewedDigest: null,
      toolEnabled: {},
      enabled: false,
    });
    if (!updated) return null;
    return { connection: publicConnection(updated), ok: false, error: message };
  }
}

/** Connections whose tools may be offered to the model: on, healthy, reviewed, with picks. */
export async function chatConnections(userId: string): Promise<McpConnectionRow[]> {
  const rows = (await prisma.mcpConnection.findMany({ where: { userId, enabled: true, status: 'connected' } })) as unknown as McpConnectionRow[];
  return rows.filter((row) => Boolean(row.toolsDigest) && row.toolsDigest === row.reviewedDigest && Object.keys(enabledMap(row)).length > 0);
}

export function enabledToolsFor(row: McpConnectionRow): NormalizedMcpTool[] {
  const allowlist = enabledMap(row);
  return normalizeToolNames(row.name, storedTools(row)).filter((tool) => allowlist[tool.name] === true);
}
