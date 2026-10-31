/**
 * Server-side URL protection for user supplied MCP endpoints. All MCP traffic
 * leaves from this app server, so a user could otherwise point a connection at
 * a cloud metadata service or an internal port. Every request therefore has to
 * pass this guard: HTTPS and an allowed port, no credentials in the URL, no
 * loopback, link-local or private literal address, a DNS answer that is entirely
 * public, and the same checks again on every redirect hop, which is additionally
 * pinned to the original origin. Address resolution is injectable so the policy
 * is unit-testable, and tests can opt into private targets for a local fixture.
 */
import { promises as dns } from 'node:dns';

export type AddressResolver = (hostname: string) => Promise<string[]>;

export type McpUrlErrorCode =
  | 'invalid_url'
  | 'https_required'
  | 'unsupported_scheme'
  | 'url_credentials'
  | 'blocked_port'
  | 'blocked_host'
  | 'blocked_address'
  | 'dns_failed'
  | 'redirect_blocked'
  | 'too_many_redirects'
  | 'response_too_large';

export class McpUrlError extends Error {
  readonly code: McpUrlErrorCode;
  readonly status: number;

  constructor(code: McpUrlErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'McpUrlError';
  }
}

/** Only the default HTTPS port, so a connection cannot probe an internal service. */
export const ALLOWED_MCP_PORTS = new Set([443]);

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.onion', '.test'];
const BLOCKED_HOSTS = new Set(['localhost']);

const isDigits = (value: string, radix: number, max: number) =>
  value.length > 0 && value.length <= (radix === 10 ? 3 : 4) && !Number.isNaN(Number.parseInt(value, radix)) && Number.parseInt(value, radix) <= max;

function blockedIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2 || c === 3)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

/** The 8 16-bit groups of an IPv6 text address, or null when it is not one. */
function parseIpv6Groups(address: string): number[] | null {
  let body = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (!body.includes(':')) return null;
  const tail: number[] = [];
  const lastColon = body.lastIndexOf(':');
  const lastChunk = body.slice(lastColon + 1);
  if (lastChunk.includes('.')) {
    const v4 = parseIpv4(lastChunk);
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    body = body.slice(0, lastColon);
  }
  const marker = body.indexOf('::');
  if (marker !== -1 && body.indexOf('::', marker + 1) !== -1) return null;
  const headText = marker === -1 ? body : body.slice(0, marker);
  const restText = marker === -1 ? '' : body.slice(marker + 2);
  const words = (text: string): number[] | null => {
    if (text === '') return [];
    const chunks = text.split(':');
    const parsed = chunks.map((chunk) => (/^[0-9a-f]{1,4}$/.test(chunk) ? Number.parseInt(chunk, 16) : Number.NaN));
    return parsed.some((value) => Number.isNaN(value)) ? null : parsed;
  };
  const headWords = words(headText);
  const restWords = words(restText);
  if (!headWords || !restWords) return null;
  const flat = [...headWords, ...restWords, ...tail];
  if (marker === -1) return flat.length === 8 ? flat : null;
  const gap = 8 - flat.length;
  if (gap < 1) return null;
  return [...headWords, ...new Array<number>(gap).fill(0), ...restWords, ...tail];
}

const fromGroups = (high: number, low: number) => [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];

function blockedIpv6(groups: number[]): boolean {
  const [first, second, third] = groups;
  if (groups.every((group) => group === 0)) return true; // :: unspecified
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1 loopback
  if (first === 0x2001 && second === 0x0000) return true; // 2001:0000::/32 Teredo
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2002) return blockedIpv4(fromGroups(second, third)); // 2002::/16 6to4
  if (first === 0x0064 && second === 0xff9b) return blockedIpv4(fromGroups(groups[6], groups[7])); // NAT64
  if (first === 0x0000 && second === 0x0000 && third === 0xffff) return blockedIpv4(fromGroups(groups[6], groups[7])); // v4-mapped
  const firstNonZero = groups.findIndex((group) => group !== 0);
  // A leading run of zero groups carrying an IPv4 tail (deprecated v4-compatible form).
  if (firstNonZero >= 5) return blockedIpv4(fromGroups(groups[6], groups[7]));
  return false;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (isDigits(part, 10, 255) ? Number.parseInt(part, 10) : NaN));
  return octets.every((octet) => !Number.isNaN(octet)) ? octets : null;
}

/** True for loopback, link-local, private, multicast, reserved or otherwise unroutable targets. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = parseIpv4(bare);
  if (v4) return blockedIpv4(v4);
  const groups = parseIpv6Groups(bare);
  return groups ? blockedIpv6(groups) : true; // Unparseable: treat as blocked.
}

export interface UrlGuardOptions {
  /**
   * Origins the operator explicitly trusts (tests point at a local fixture
   * server, a self-hosted deployment may trust a LAN host). Nothing inside one of
   * these origins goes through the scheme, port or address screens; every other
   * target is checked in full. Empty by default, so HTTPS and public addresses
   * are required.
   */
  allowedOrigins?: readonly string[];
}

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

/** The origins an operator trusts, from `MCP_ALLOWED_ORIGINS` (comma separated). */
export function trustedOriginsFromEnv(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const isTrustedOrigin = (url: URL, allowedOrigins: readonly string[] = []): boolean =>
  allowedOrigins.includes(url.origin);

/** Parses and statically screens an MCP endpoint. Throws `McpUrlError`. */
export function assertSafeMcpUrl(raw: string, options: UrlGuardOptions = {}): URL {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new McpUrlError('invalid_url', 'Enter an MCP server URL.');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new McpUrlError('invalid_url', 'That is not a valid URL.');
  }
  if (url.username || url.password) throw new McpUrlError('url_credentials', 'Put the token in the token field, not in the URL.');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new McpUrlError('unsupported_scheme', `The ${url.protocol} scheme is not supported. MCP servers use HTTPS.`);
  }
  const hostname = normalizedHostname(url.hostname);
  if (!hostname) throw new McpUrlError('invalid_url', 'That URL has no host name.');
  if (isTrustedOrigin(url, options.allowedOrigins)) return url;
  if (url.protocol === 'http:') throw new McpUrlError('https_required', 'MCP servers must use HTTPS.');
  const port = url.port ? Number(url.port) : 443;
  if (!ALLOWED_MCP_PORTS.has(port)) throw new McpUrlError('blocked_port', `Port ${port} is not allowed. MCP servers must use the default HTTPS port.`);
  if (BLOCKED_HOSTS.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new McpUrlError('blocked_host', `"${hostname}" is not an allowed MCP host.`);
  }
  const literalV4 = parseIpv4(hostname) !== null;
  const literalV6 = !literalV4 && hostname.includes(':');
  if (!literalV4 && !literalV6 && !hostname.includes('.')) throw new McpUrlError('blocked_host', 'MCP servers need a fully qualified host name.');
  if ((literalV4 || literalV6) && isBlockedAddress(hostname)) {
    throw new McpUrlError('blocked_address', 'That address is inside a private or reserved range, so it cannot be connected to.');
  }
  return url;
}

const systemResolver: AddressResolver = async (hostname) => {
  const addresses: string[] = [];
  try {
    addresses.push(...(await dns.resolve4(hostname)));
  } catch {
    /* no A records */
  }
  try {
    addresses.push(...(await dns.resolve6(hostname)));
  } catch {
    /* no AAAA records */
  }
  if (addresses.length === 0) {
    const looked = await dns.lookup(hostname, { all: true }).catch(() => []);
    addresses.push(...looked.map((entry) => entry.address));
  }
  return addresses;
};

/** Re-resolves the host and rejects it when any answer is private or reserved. */
export async function assertPublicEndpoint(url: URL, options: UrlGuardOptions & { resolveAddresses?: AddressResolver } = {}): Promise<void> {
  if (isTrustedOrigin(url, options.allowedOrigins)) return;
  const resolveAddresses = options.resolveAddresses ?? systemResolver;
  const hostname = normalizedHostname(url.hostname);
  if (parseIpv4(hostname) || hostname.includes(':')) {
    if (isBlockedAddress(hostname)) throw new McpUrlError('blocked_address', 'That address is inside a private or reserved range, so it cannot be connected to.');
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolveAddresses(hostname);
  } catch {
    throw new McpUrlError('dns_failed', `"${hostname}" could not be resolved.`);
  }
  if (addresses.length === 0) throw new McpUrlError('dns_failed', `"${hostname}" could not be resolved.`);
  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked) throw new McpUrlError('blocked_address', `"${hostname}" resolves to ${blocked}, which is not an allowed MCP address.`);
}

export interface SafeFetchOptions {
  maxResponseBytes: number;
  maxRedirects?: number;
  resolveAddresses?: AddressResolver;
  allowedOrigins?: readonly string[];
  /** Test seam: replaces the real HTTP call so the policy can be observed. */
  transportFetch?: TransportFetch;
  /** Extra headers, e.g. the bearer token, sent only to the original origin. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type TransportFetch = (url: string, init?: RequestInit) => Promise<Response>;

const hopSignal = (signal: AbortSignal | null | undefined, timeoutMs?: number): { signal?: AbortSignal; cleanup: () => void } => {
  if (!timeoutMs) return { signal: signal ?? undefined, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('The MCP request timed out.')), timeoutMs);
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
};

function bounded(response: Response, maxBytes: number): Response {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new McpUrlError('response_too_large', `The MCP server offered more than ${(maxBytes / 1024).toFixed(0)} KB.`, 502);
  if (!response.body) return response;
  const iterator = response.body.getReader();
  let used = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.read();
      if (done) {
        controller.close();
        return;
      }
      used += value.byteLength;
      if (used > maxBytes) {
        await iterator.cancel();
        controller.error(new McpUrlError('response_too_large', `The MCP server sent more than ${(maxBytes / 1024).toFixed(0)} KB.`, 502));
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await iterator.cancel(reason).catch(() => {});
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * A `fetch` for MCP traffic: every hop is screened again, redirects stay on the
 * original origin, and responses are byte-capped. Note the documented limit: the
 * address is checked before the request is issued, so a DNS answer that changes
 * between the check and the connection is only caught by the per-hop recheck.
 */
export function createSafeFetch(options: SafeFetchOptions): typeof fetch {
  const resolve = options.resolveAddresses ?? systemResolver;
  const transport: TransportFetch = options.transportFetch ?? ((url, init) => fetch(url, init));
  const maxRedirects = options.maxRedirects ?? 3;
  const guard = { allowedOrigins: options.allowedOrigins ?? [] };
  return async (input, init) => {
    const start = typeof input === 'string' || input instanceof URL ? new URL(String(input)) : input.url ? new URL(input.url) : null;
    if (!start) throw new McpUrlError('invalid_url', 'MCP requests need a URL.');
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    let current = assertSafeMcpUrl(start.toString(), guard);
    const checked = new Set<string>();
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (!checked.has(current.origin)) {
        await assertPublicEndpoint(current, { ...guard, resolveAddresses: resolve });
        checked.add(current.origin);
      }
      const headers = new Headers(init?.headers ?? undefined);
      for (const [name, value] of Object.entries(options.headers ?? {})) if (!headers.has(name)) headers.set(name, value);
      const { signal, cleanup } = hopSignal(init?.signal ?? undefined, options.timeoutMs);
      let response: Response;
      try {
        response = await transport(current.toString(), { ...init, method, headers, signal, redirect: 'manual' });
      } finally {
        cleanup();
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) return response;
        const next = new URL(location, current);
        if (next.origin !== start.origin) throw new McpUrlError('redirect_blocked', `The server redirected to ${next.origin}, which is a different origin.`, 502);
        if (hop === maxRedirects) throw new McpUrlError('too_many_redirects', 'The MCP server redirected too many times.', 502);
        // Every hop is screened again, including a fresh address resolution.
        current = assertSafeMcpUrl(next.toString(), guard);
        checked.delete(next.origin);
        continue;
      }
      return bounded(response, options.maxResponseBytes);
    }
    throw new McpUrlError('too_many_redirects', 'The MCP server redirected too many times.', 502);
  };
}
