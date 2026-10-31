/**
 * The MCP tool loop is off until the deployment switches it on, so a schema or
 * credential mistake cannot silently start calling external services.
 */
export type McpMode = 'off' | 'on';

export function mcpMode(): McpMode {
  return process.env.MCP_TOOLS?.trim().toLowerCase() === 'on' ? 'on' : 'off';
}

export function mcpToolsEnabled(): boolean {
  return mcpMode() === 'on';
}

/** Thrown when a request asks for MCP tools while the flag is off. */
export class McpDisabledError extends Error {
  readonly code = 'mcp_disabled';

  constructor() {
    super('MCP tools are not enabled on this deployment.');
    this.name = 'McpDisabledError';
  }
}

/**
 * A caller may only offer tools when the flag is on. Council and scheduled
 * tasks never call this: they stay tool free in this release.
 */
export function assertMcpToolsEnabled(): void {
  if (!mcpToolsEnabled()) throw new McpDisabledError();
}

export const DEFAULT_APPROVAL_TTL_SECONDS = 120;

/**
 * How long a pending tool approval stays decidable. Short on purpose: the
 * approval waits in a live chat stream, and a stale prompt should expire
 * rather than sit on a half-finished turn.
 */
export function mcpApprovalTtlSeconds(): number {
  const raw = Number(process.env.MCP_APPROVAL_TTL_SECONDS?.trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_APPROVAL_TTL_SECONDS;
  return Math.min(Math.max(Math.floor(raw), 1), 600);
}

/** Upper bound on tool definitions offered to the model in one chat turn. */
export const MAX_OFFERED_TOOLS = 64;
