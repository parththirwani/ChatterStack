/**
 * The client-side rules the add-server flow applies before any request leaves the
 * browser. They mirror the server's own checks (`/api/mcp/connections` re-checks
 * everything), so a typo is caught where it was made instead of costing a round trip.
 */
import type { McpCatalogEntry } from '@/src/config/mcp-catalog';

export const MAX_URL_LENGTH = 2_048;
export const MAX_TOKEN_LENGTH = 4_096;
export const MAX_NAME_LENGTH = 60;

/** Mirrors the server's URL rules early, so a typo never leaves the browser. */
export function validateConnectionForm({ name, url }: { name: string; url: string }): { field: 'name' | 'url'; message: string } | null {
  if (!name.trim()) return { field: 'name', message: 'Give this connection a name.' };
  if (!url.trim()) return { field: 'url', message: 'Give the server URL.' };
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { field: 'url', message: 'That is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:') return { field: 'url', message: 'MCP servers must use HTTPS.' };
  if (parsed.username || parsed.password) return { field: 'url', message: 'Put credentials in the token field, not in the URL.' };
  if (url.trim().length > MAX_URL_LENGTH) return { field: 'url', message: `Keep the URL under ${MAX_URL_LENGTH} characters.` };
  return null;
}

/** Catalog entry labels: whose token it needs, and whether it was verified. */
export function catalogAuthLabel(entry: McpCatalogEntry): string {
  if (entry.auth === 'none') return 'No token needed';
  return entry.credentialOwner === 'user' ? 'Needs your own token' : 'Needs a token';
}

/** What the user has to go and get, in their words, derived from the entry itself. */
export function catalogTokenLabel(entry: McpCatalogEntry): string {
  const short = entry.name.replace(/\s*\(.*?\)\s*$/, '').trim() || entry.name;
  return `${short} token`;
}

/** What the catalog says about the credential, in the sheet's own words. */
export function catalogAuthStatement(entry: McpCatalogEntry): string {
  if (entry.auth === 'none') return 'No token is needed: this endpoint answers without a credential, so nothing is stored for it.';
  return `This server needs your own ${catalogTokenLabel(entry)}. ChatterStack stores it encrypted for this connection only and sends it just to ${new URL(entry.url).host} - never to another server, another user, or the model.`;
}

/** Directory search: matches the name, the blurb and the host, case-insensitively. */
export function filterCatalog(entries: readonly McpCatalogEntry[], query: string): McpCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  const words = needle.split(/\s+/);
  return entries.filter((entry) => {
    const haystack = `${entry.name} ${entry.blurb} ${new URL(entry.url).host}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
