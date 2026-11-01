/**
 * The built-in MCP connections users can start from. A catalog entry is a
 * prefilled URL plus an honest statement about what it takes to use it: nothing
 * here carries a credential, and `ready` only ever means "this endpoint and its
 * auth path were verified from the deployed environment". Entries that need the
 * user's own token stay marked as such until that token is supplied and tested.
 */
export type McpCatalogAuth = 'none' | 'bearer';

export interface McpCatalogEntry {
  id: string;
  name: string;
  url: string;
  transport: 'streamable_http';
  auth: McpCatalogAuth;
  /** Whose credential it is. Catalog entries never use an app-level token. */
  credentialOwner: 'none' | 'user';
  blurb: string;
  docsUrl: string;
  /** Set only after a live check from the deployed environment. */
  verified: {
    at: string;
    anonymous: boolean;
    tools: string[];
    evidence: string;
  } | null;
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'cloudflare-docs',
    name: 'Cloudflare documentation',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    transport: 'streamable_http',
    auth: 'none',
    credentialOwner: 'none',
    blurb: 'Search the Cloudflare documentation for Workers, Pages, R2, Zero Trust and more.',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/guides/connect-mcp-client/',
    verified: {
      at: '2026-10-31',
      anonymous: true,
      tools: ['search_cloudflare_documentation'],
      evidence: 'POST /mcp initialize and tools/list from this deployment returned 200 with serverInfo "docs-ai-search" 0.5.0 and protocol 2025-06-18, with no token.',
    },
  },
  {
    id: 'github-readonly',
    name: 'GitHub (read only)',
    url: 'https://api.githubcopilot.com/mcp/readonly',
    transport: 'streamable_http',
    auth: 'bearer',
    credentialOwner: 'user',
    blurb: 'Read repositories, issues and pull requests with your own GitHub token. Never the app login.',
    docsUrl: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
    verified: null,
  },
  {
    id: 'linear-readonly',
    name: 'Linear (read only)',
    url: 'https://mcp.linear.app/mcp/readonly',
    transport: 'streamable_http',
    auth: 'bearer',
    credentialOwner: 'user',
    blurb: 'Read issues and projects with your own Linear API key. OAuth sign-in comes later.',
    docsUrl: 'https://linear.app/docs/mcp',
    verified: null,
  },
];

export function findMcpCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
