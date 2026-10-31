/**
 * Browser-safe MCP shapes. The server builds these from its own rows, and they
 * are the only MCP representation a client ever sees: a connection's credential
 * is replaced by `hasCredential`, and tool entries carry the server's own names.
 */

export interface McpToolView {
  /** The server's own tool name; also the enablement map key. */
  id: string;
  name: string;
  description: string;
  readOnly: boolean;
  schemaBytes: number;
  enabled: boolean;
}

export type McpConnectionStatus = 'untested' | 'connected' | 'error';

export interface McpConnectionView {
  id: string;
  name: string;
  url: string;
  host: string;
  catalogId: string | null;
  transport: string;
  authMode: 'none' | 'bearer';
  hasCredential: boolean;
  enabled: boolean;
  status: McpConnectionStatus;
  lastError: string | null;
  lastCheckedAt: string | null;
  tools: McpToolView[];
  toolCount: number;
  /** A new tool list must be reviewed before the connection can run tools. */
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpConnectionsResponse {
  connections: McpConnectionView[];
  limit: number;
}
