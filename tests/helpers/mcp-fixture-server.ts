/**
 * A real Streamable HTTP MCP server, in-process, built with the same official SDK
 * the app uses. Integration tests start one, point a connection at it and get
 * genuine protocol traffic without leaving the test process.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export interface McpFixtureOptions {
  /** When set, only this bearer token is accepted. */
  token?: string;
  /** `default` has a spaced name, a plain echo, a slow tool and a failing tool. */
  tools?: 'default' | 'none' | 'many' | 'oversized';
  /** How long the slow tool waits before it answers. */
  slowMs?: number;
  /** Text the echo tool returns, so a size cap can be exercised. */
  echoText?: string;
  /** Redirect the first request to this location instead of serving it. */
  redirectTo?: string;
  /** Redirect once to a same-origin path before serving, to prove hops are rechecked. */
  redirectOnceTo?: string;
  /** Name reported in `serverInfo`, useful in assertions. */
  name?: string;
  /** Bind a specific port, so an already stored URL keeps pointing here. */
  port?: number;
}

export interface McpFixture {
  origin: string;
  url: string;
  port: number;
  /** Authorization headers the server actually received. */
  authorizations: string[];
  /** How many `tools/call` requests arrived. */
  calls: string[];
  close(): Promise<void>;
}

const buildServer = (options: McpFixtureOptions): McpServer => {
  const server = new McpServer({ name: options.name ?? 'chatterstack-fixture', version: '1.0.0' });
  const variant = options.tools ?? 'default';
  if (variant === 'default') {
    server.registerTool(
      'docs.search',
      {
        title: 'Search the docs',
        description: 'Find documentation pages that match a query.',
        inputSchema: { query: z.string().describe('What to look up') },
        annotations: { readOnlyHint: true },
      },
      async ({ query }) => ({ content: [{ type: 'text', text: `docs for ${query}` }] })
    );
    server.registerTool(
      'echo',
      { description: 'Echo the arguments back.', inputSchema: { value: z.string().optional() } },
      async ({ value }) => ({ content: [{ type: 'text', text: options.echoText ?? `echo:${value ?? ''}` }] })
    );
    server.registerTool(
      'slow',
      { description: 'Answers late.', inputSchema: {} },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, options.slowMs ?? 500));
        return { content: [{ type: 'text', text: 'eventually' }] };
      }
    );
    server.registerTool(
      'explode',
      { description: 'Always reports a tool error.', inputSchema: {} },
      async () => ({ isError: true, content: [{ type: 'text', text: 'the tool failed' }] })
    );
  }
  if (variant === 'many') {
    for (let index = 0; index < 40; index += 1) {
      server.registerTool(`tool_${index}`, { description: `Tool ${index}`, inputSchema: {} }, async () => ({ content: [] }));
    }
  }
  if (variant === 'oversized') {
    const properties: Record<string, z.ZodString> = {};
    for (let index = 0; index < 400; index += 1) properties[`field_${index}_with_a_long_name`] = z.string();
    server.registerTool('huge', { description: 'A schema far too large to offer.', inputSchema: properties }, async () => ({ content: [] }));
  }
  return server;
};

export async function startMcpFixture(options: McpFixtureOptions = {}): Promise<McpFixture> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const fixture: Omit<McpFixture, 'origin' | 'url' | 'port' | 'close'> = { authorizations: [], calls: [] };
  let redirected = false;

  const readBody = async (request: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  };

  const reject = (response: ServerResponse, status: number, message: string) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path !== '/mcp') return reject(response, 404, 'Not found');
    const authorization = request.headers.authorization;
    fixture.authorizations.push(authorization ?? '');
    if (options.token && authorization !== `Bearer ${options.token}`) return reject(response, 401, 'Unauthorized');
    const body = await readBody(request);

    if (options.redirectTo && request.method === 'POST') {
      response.writeHead(302, { location: options.redirectTo });
      response.end();
      return;
    }
    if (options.redirectOnceTo && request.method === 'POST' && !redirected) {
      redirected = true;
      response.writeHead(302, { location: options.redirectOnceTo });
      response.end();
      return;
    }

    const sessionId = request.headers['mcp-session-id'];
    if (request.method === 'POST' && body !== undefined && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      const server = buildServer(options);
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
      if (transport.sessionId) transports.set(transport.sessionId, transport);
      return;
    }

    const transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
    if (!transport) return reject(response, 400, 'No valid session');
    const method = typeof body === 'object' && body !== null ? (body as { method?: unknown }).method : undefined;
    if (method === 'tools/call') {
      fixture.calls.push(String((body as { params?: { name?: string } }).params?.name ?? ''));
    }
    await transport.handleRequest(request, response, body);
  };

  const nodeServer: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) reject(response, 500, 'Fixture failure');
    });
  });
  nodeServer.keepAliveTimeout = 250;
  await new Promise<void>((resolve) => nodeServer.listen(options.port ?? 0, '127.0.0.1', resolve));
  const port = (nodeServer.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    ...fixture,
    origin,
    url: `${origin}/mcp`,
    port,
    close: async () => {
      for (const transport of transports.values()) await transport.close().catch(() => {});
      transports.clear();
      // Close stops listening, but an open streamable-HTTP GET would hold the
      // server for seconds; drop every socket so the fixture ends promptly.
      const closing = new Promise<void>((resolve, rejectClose) =>
        nodeServer.close((error) => (error ? rejectClose(error) : resolve())));
      nodeServer.closeAllConnections();
      await closing;
    },
  };
}
