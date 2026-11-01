import { describe, expect, it, vi } from 'vitest';
import {
  McpUrlError,
  assertPublicEndpoint,
  assertSafeMcpUrl,
  createSafeFetch,
  isBlockedAddress,
  trustedOriginsFromEnv,
} from '@/src/lib/server/mcp-url';

const codeOf = async (call: () => unknown): Promise<string> => {
  try {
    call();
    return 'no error';
  } catch (error) {
    return error instanceof McpUrlError ? error.code : `other: ${String(error)}`;
  }
};

describe('the MCP URL screen', () => {
  it('accepts a normal HTTPS MCP endpoint', () => {
    expect(assertSafeMcpUrl('https://docs.mcp.cloudflare.com/mcp').hostname).toBe('docs.mcp.cloudflare.com');
    expect(assertSafeMcpUrl('  https://mcp.example.com:443/mcp  ').port).toBe('');
  });

  it('refuses anything that is not HTTPS', async () => {
    expect(await codeOf(() => assertSafeMcpUrl('http://mcp.example.com/mcp'))).toBe('https_required');
    expect(await codeOf(() => assertSafeMcpUrl('ftp://mcp.example.com/mcp'))).toBe('unsupported_scheme');
    expect(await codeOf(() => assertSafeMcpUrl('file:///etc/passwd'))).toBe('unsupported_scheme');
    expect(await codeOf(() => assertSafeMcpUrl('gopher://mcp.example.com'))).toBe('unsupported_scheme');
    expect(await codeOf(() => assertSafeMcpUrl('javascript:alert(1)'))).toBe('unsupported_scheme');
  });

  it('refuses credentials hidden in the URL', async () => {
    expect(await codeOf(() => assertSafeMcpUrl('https://user:secret@mcp.example.com/mcp'))).toBe('url_credentials');
    expect(await codeOf(() => assertSafeMcpUrl('https://token@mcp.example.com/mcp'))).toBe('url_credentials');
  });

  it('refuses ports other than the default HTTPS port', async () => {
    expect(await codeOf(() => assertSafeMcpUrl('https://mcp.example.com:8443/mcp'))).toBe('blocked_port');
    expect(await codeOf(() => assertSafeMcpUrl('https://mcp.example.com:444/mcp'))).toBe('blocked_port');
  });

  it('refuses internal host names', async () => {
    for (const host of ['http://localhost/mcp', 'https://localhost/mcp', 'https://api.internal/mcp', 'https://db.local/mcp', 'https://metadata.home.arpa/mcp', 'https://onion.onion/mcp']) {
      expect(await codeOf(() => assertSafeMcpUrl(host)), host).toBe(host.startsWith('http:') ? 'https_required' : 'blocked_host');
    }
    expect(await codeOf(() => assertSafeMcpUrl('https://intranet/mcp'))).toBe('blocked_host');
  });

  it('refuses literal private, loopback, link-local and reserved addresses', async () => {
    for (const url of [
      'https://127.0.0.1/mcp',
      'https://127.5.5.5/mcp',
      'https://10.1.2.3/mcp',
      'https://172.16.0.1/mcp',
      'https://192.168.1.9/mcp',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/mcp',
      'https://0.0.0.0/mcp',
      'https://224.0.0.1/mcp',
      'https://[::1]/mcp',
      'https://[fe80::1]/mcp',
      'https://[fd12::34]/mcp',
      'https://[::ffff:127.0.0.1]/mcp',
      'https://[2002:7f00:0001::]/mcp',
    ]) {
      expect(await codeOf(() => assertSafeMcpUrl(url)), url).toBe('blocked_address');
    }
  });

  it('trusts only the origins the operator listed', () => {
    const origin = 'http://127.0.0.1:4567';
    expect(assertSafeMcpUrl(`${origin}/mcp`, { allowedOrigins: [origin] }).port).toBe('4567');
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    process.env.MCP_ALLOWED_ORIGINS = `${origin}, https://mcp.lan`;
    expect(trustedOriginsFromEnv()).toEqual([origin, 'https://mcp.lan']);
    delete process.env.MCP_ALLOWED_ORIGINS;
    expect(trustedOriginsFromEnv()).toEqual([]);
  });
});

describe('address ranges', () => {
  it('blocks the ranges an MCP server must never reach', () => {
    for (const address of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.5', '192.0.0.1', '192.168.0.1', '198.18.0.1', '224.0.0.5', '240.0.0.1', '::', '::1', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:192.168.1.1', '2002:7f00:1::', '64:ff9b::7f00:1', '2001:0::1']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows public addresses and rejects junk as blocked', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700::6810:84e5', '2001:4860:4860::8888']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
    expect(isBlockedAddress('not-an-address')).toBe(true);
  });
});

describe('re-resolving before connecting', () => {
  it('blocks a host that resolves to a private address', async () => {
    const resolveAddresses = vi.fn(async () => ['93.184.216.34', '10.0.0.5']);
    await expect(assertPublicEndpoint(new URL('https://mcp.example.com/mcp'), { resolveAddresses })).rejects.toMatchObject({
      code: 'blocked_address',
    });
    expect(resolveAddresses).toHaveBeenCalledWith('mcp.example.com');
  });

  it('accepts a fully public answer and reports a DNS failure honestly', async () => {
    await expect(assertPublicEndpoint(new URL('https://mcp.example.com/mcp'), { resolveAddresses: async () => ['93.184.216.34'] })).resolves.toBeUndefined();
    await expect(assertPublicEndpoint(new URL('https://mcp.example.com/mcp'), { resolveAddresses: async () => [] })).rejects.toMatchObject({ code: 'dns_failed' });
    await expect(assertPublicEndpoint(new URL('https://mcp.example.com/mcp'), { resolveAddresses: async () => { throw new Error('ENOTFOUND'); } })).rejects.toMatchObject({ code: 'dns_failed' });
  });

  it('skips the address policy only inside a trusted origin', async () => {
    await expect(assertPublicEndpoint(new URL('http://127.0.0.1:9/mcp'), { allowedOrigins: ['http://127.0.0.1:9'] })).resolves.toBeUndefined();
    await expect(assertPublicEndpoint(new URL('http://127.0.0.1:9/mcp'))).rejects.toMatchObject({ code: 'blocked_address' });
  });
});

const jsonResponse = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });

describe('the guarded fetch', () => {
  const guard = { maxResponseBytes: 4_096, resolveAddresses: async () => ['93.184.216.34'] };

  it('never issues a request for a host that resolves privately', async () => {
    const transportFetch = vi.fn(async () => jsonResponse('{}'));
    const safeFetch = createSafeFetch({ ...guard, resolveAddresses: async () => ['169.254.169.254'], transportFetch });
    await expect(safeFetch('https://metadata.example/mcp')).rejects.toMatchObject({ code: 'blocked_address' });
    expect(transportFetch).not.toHaveBeenCalled();
  });

  it('sends the bearer header and refuses to follow redirects itself', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const transportFetch = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return jsonResponse('{"ok":true}');
    });
    const safeFetch = createSafeFetch({ ...guard, headers: { Authorization: 'Bearer abc' }, transportFetch });
    const response = await safeFetch('https://mcp.example.com/mcp', { method: 'POST', body: '{}' });
    expect(await response.json()).toEqual({ ok: true });
    const headers = seen[0].init!.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer abc');
    expect(seen[0].init!.redirect).toBe('manual');
    expect(seen[0].url).toBe('https://mcp.example.com/mcp');
  });

  it('follows a same-origin redirect and screens it again', async () => {
    const resolver = vi.fn(async () => ['93.184.216.34']);
    const transportFetch = vi.fn(async (url: string) =>
      url.endsWith('/moved') ? jsonResponse('{"ok":true}') : new Response(null, { status: 302, headers: { location: '/moved' } })
    );
    const safeFetch = createSafeFetch({ ...guard, resolveAddresses: resolver, transportFetch });
    const response = await safeFetch('https://mcp.example.com/mcp');
    expect(await response.json()).toEqual({ ok: true });
    expect(transportFetch).toHaveBeenCalledTimes(2);
    expect(resolver.mock.calls.length).toBeGreaterThan(1);
  });

  it('blocks a same-origin redirect whose DNS answer turned private', async () => {
    let resolutions = 0;
    const resolver = vi.fn(async () => {
      resolutions += 1;
      return resolutions === 1 ? ['93.184.216.34'] : ['169.254.169.254'];
    });
    const transportFetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/moved' } }));
    const safeFetch = createSafeFetch({ ...guard, resolveAddresses: resolver, transportFetch });
    await expect(safeFetch('https://mcp.example.com/mcp')).rejects.toMatchObject({ code: 'blocked_address' });
    expect(transportFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect that changes origin', async () => {
    const transportFetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/mcp' } }));
    const safeFetch = createSafeFetch({ ...guard, transportFetch });
    await expect(safeFetch('https://mcp.example.com/mcp')).rejects.toMatchObject({ code: 'redirect_blocked' });
    expect(transportFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect that jumps to a non-HTTPS scheme', async () => {
    const transportFetch = vi.fn(async () => new Response(null, { status: 308, headers: { location: 'http://mcp.example.com/mcp' } }));
    const safeFetch = createSafeFetch({ ...guard, transportFetch });
    // A scheme change is also an origin change, so the hop never happens.
    await expect(safeFetch('https://mcp.example.com/mcp')).rejects.toMatchObject({ code: 'redirect_blocked' });
  });

  it('stops a redirect loop', async () => {
    const transportFetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    const safeFetch = createSafeFetch({ ...guard, transportFetch, maxRedirects: 2 });
    await expect(safeFetch('https://mcp.example.com/mcp')).rejects.toMatchObject({ code: 'too_many_redirects' });
    expect(transportFetch).toHaveBeenCalledTimes(3);
  });

  it('caps a declared response size and a streamed one', async () => {
    const declared = createSafeFetch({ ...guard, transportFetch: async () => jsonResponse('x'.repeat(10), { headers: { 'content-length': '99999' } }) });
    await expect(declared('https://mcp.example.com/mcp')).rejects.toMatchObject({ code: 'response_too_large' });

    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 8; index += 1) controller.enqueue(new Uint8Array(1_024));
        controller.close();
      },
    });
    const streaming = createSafeFetch({ maxResponseBytes: 2_048, resolveAddresses: guard.resolveAddresses, transportFetch: async () => new Response(streamed) });
    const response = await streaming('https://mcp.example.com/mcp');
    await expect(response.text()).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('passes an abort through to the transport', async () => {
    const controller = new AbortController();
    const transportFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        })
    );
    const safeFetch = createSafeFetch({ ...guard, transportFetch });
    const pending = safeFetch('https://mcp.example.com/mcp', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
