import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpUrlError, createSafeFetch } from '@/src/lib/server/mcp-url';

const listen = async (handler: RequestListener): Promise<{ server: Server; origin: string; port: number }> => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port, origin: `http://127.0.0.1:${port}` };
};

const closeAll: Array<() => Promise<void>> = [];

const stop = async () => {
  while (closeAll.length) await closeAll.pop()!();
};

afterEach(stop);

const codeOf = async (call: () => Promise<unknown>): Promise<string> => {
  try {
    await call();
    return 'no error';
  } catch (error) {
    return error instanceof McpUrlError ? error.code : `other: ${String(error)}`;
  }
};

describe('a real redirecting MCP host', () => {
  it('refuses the plain-HTTP fixture unless its origin is trusted', async () => {
    const target = await listen((_request, response) => response.end('{"ok":true}'));
    closeAll.push(async () => new Promise<void>((resolve) => target.server.close(() => resolve())));
    const guard = { maxResponseBytes: 4_096 };
    expect(await codeOf(() => createSafeFetch(guard)(`${target.origin}/mcp`))).toBe('https_required');
    const trusted = createSafeFetch({ ...guard, allowedOrigins: [target.origin] });
    const response = await trusted(`${target.origin}/mcp`);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('follows a same-origin redirect and stops a cross-origin one', async () => {
    let askedElsewhere = false;
    const redirector = await listen((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (path === '/mcp') {
        response.writeHead(302, { location: '/mcp/v2' });
        response.end();
        return;
      }
      if (path === '/cross') {
        response.writeHead(302, { location: `${elsewhere.origin}/mcp` });
        response.end();
        return;
      }
      response.end('{"served":"final"}');
    });
    const elsewhere = await listen((_request, response) => {
      askedElsewhere = true;
      response.end('{"served":"elsewhere"}');
    });
    closeAll.push(
      async () => new Promise<void>((resolve) => redirector.server.close(() => resolve())),
      async () => new Promise<void>((resolve) => elsewhere.server.close(() => resolve()))
    );

    const trusted = createSafeFetch({ maxResponseBytes: 4_096, allowedOrigins: [redirector.origin] });
    const followed = await trusted(`${redirector.origin}/mcp`);
    expect(await followed.json()).toEqual({ served: 'final' });
    expect(await codeOf(() => trusted(`${redirector.origin}/cross`))).toBe('redirect_blocked');
    expect(askedElsewhere).toBe(false);
  });

  it('will not be walked into the metadata address through a redirect chain', async () => {
    const redirector = await listen((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const target = path === '/mcp' ? '/hop' : path === '/hop' ? 'http://169.254.169.254/latest/meta-data/' : '/end';
      response.writeHead(302, { location: target });
      response.end();
    });
    closeAll.push(async () => new Promise<void>((resolve) => redirector.server.close(() => resolve())));
    const trusted = createSafeFetch({ maxResponseBytes: 4_096, allowedOrigins: [redirector.origin] });
    // The link-local hop is a different origin, so it is refused before any request.
    expect(await codeOf(() => trusted(`${redirector.origin}/mcp`))).toBe('redirect_blocked');
  });

  it('caps a body that is bigger than the allowance', async () => {
    const big = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('x'.repeat(64 * 1024));
    });
    closeAll.push(async () => new Promise<void>((resolve) => big.server.close(() => resolve())));
    const trusted = createSafeFetch({ maxResponseBytes: 8_192, allowedOrigins: [big.origin] });
    const response = await trusted(`${big.origin}/mcp`);
    expect(await codeOf(() => response.text())).toBe('response_too_large');
  });
});
