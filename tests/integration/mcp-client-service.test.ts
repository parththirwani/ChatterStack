import { afterEach, describe, expect, it } from 'vitest';
import {
  MCP_LIMITS,
  McpError,
  callMcpTool,
  discoverMcpTools,
  estimateToolTokens,
  normalizeToolNames,
  reverseToolName,
} from '@/src/lib/server/mcp-client';
import { countTokens } from '@/src/lib/tokens';
import { startMcpFixture, type McpFixture } from '../helpers/mcp-fixture-server';

let fixture: McpFixture | null = null;

const failure = async (call: Promise<unknown>): Promise<McpError> =>
  call.then(() => {
    throw new Error('The call was expected to fail.');
  }, (error) => error as McpError);

const stop = async () => {
  await fixture?.close();
  fixture = null;
};

afterEach(stop);

describe('the MCP client service', () => {
  it('lists the tools a server offers, with the hints the UI shows', async () => {
    fixture = await startMcpFixture();
    const tools = await discoverMcpTools({ url: fixture.url }, { allowedOrigins: [fixture.origin] });
    expect(tools.map((tool) => tool.name)).toEqual(['docs.search', 'echo', 'slow', 'explode']);
    expect(tools[0]).toMatchObject({ description: 'Find documentation pages that match a query.', readOnly: true });
    expect(tools[0].schemaBytes).toBeGreaterThan(10);
    expect(JSON.stringify(tools[0].inputSchema)).toContain('query');
  });

  it('carries the user token to the server on both discovery and calls', async () => {
    fixture = await startMcpFixture({ token: 'ghp_user_token' });
    const endpoint = { url: fixture.url, token: 'ghp_user_token' };
    const tools = await discoverMcpTools(endpoint, { allowedOrigins: [fixture.origin] });
    expect(tools).toHaveLength(4);
    expect(await callMcpTool(endpoint, 'echo', { value: 'hi' }, { allowedOrigins: [fixture.origin] })).toBe('echo:hi');
    expect(fixture.authorizations).toContain('Bearer ghp_user_token');
  });

  it('refuses a server that rejects the token, without repeating it', async () => {
    fixture = await startMcpFixture({ token: 'right-token' });
    await expect(
      discoverMcpTools({ url: fixture.url, token: 'wrong-token' }, { allowedOrigins: [fixture.origin] })
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('runs a tool and reports a tool-level failure as an error', async () => {
    fixture = await startMcpFixture({ echoText: 'the answer' });
    const endpoint = { url: fixture.url };
    expect(await callMcpTool(endpoint, 'echo', {}, { allowedOrigins: [fixture.origin] })).toBe('the answer');
    expect(fixture.calls).toContain('echo');
    await expect(callMcpTool(endpoint, 'explode', {}, { allowedOrigins: [fixture.origin] })).rejects.toMatchObject({
      code: 'tool_failed',
      message: 'the tool failed',
    });
  });

  it('gives up on a tool that answers too late', async () => {
    fixture = await startMcpFixture({ slowMs: 2_000 });
    const started = Date.now();
    await expect(
      callMcpTool({ url: fixture.url }, 'slow', {}, { allowedOrigins: [fixture.origin], timeoutMs: 250 })
    ).rejects.toBeInstanceOf(McpError);
    await expect(
      callMcpTool({ url: fixture.url }, 'slow', {}, { allowedOrigins: [fixture.origin], timeoutMs: 250 })
    ).rejects.toMatchObject({ code: 'timeout', status: 504 });
    expect(Date.now() - started).toBeLessThan(1_800);
  });

  it('cancels the in-flight MCP request when the caller aborts', async () => {
    fixture = await startMcpFixture({ slowMs: 3_000 });
    const controller = new AbortController();
    const pending = callMcpTool({ url: fixture.url }, 'slow', {}, { allowedOrigins: [fixture.origin], signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const started = Date.now();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('rejects a connection whose schema is too large to offer', async () => {
    fixture = await startMcpFixture({ tools: 'oversized' });
    await expect(discoverMcpTools({ url: fixture.url }, { allowedOrigins: [fixture.origin] })).rejects.toMatchObject({
      code: 'oversized_schema',
    });
  });

  it('rejects a connection that offers more tools than the cap', async () => {
    fixture = await startMcpFixture({ tools: 'many' });
    const error = await failure(discoverMcpTools({ url: fixture.url }, { allowedOrigins: [fixture.origin] }));
    expect(error).toBeInstanceOf(McpError);
    expect(error.code).toBe('too_many_tools');
    expect(error.message).toContain(String(MCP_LIMITS.maxTools));
  });

  it('reports an unreachable server as unreachable, never as a secret leak', async () => {
    const endpoint = { url: 'http://127.0.0.1:9/mcp', token: 'super-secret-token' };
    const error = await failure(discoverMcpTools(endpoint, { allowedOrigins: ['http://127.0.0.1:9'], timeoutMs: 1_000 }));
    expect(error).toBeInstanceOf(McpError);
    expect(['unreachable', 'timeout']).toContain(error.code);
    expect(error.message).not.toContain('super-secret-token');
  });

  it('estimates each discovered tool from its real definition, using the model-facing name', async () => {
    fixture = await startMcpFixture();
    const tools = await discoverMcpTools({ url: fixture.url }, { allowedOrigins: [fixture.origin] });
    const named = normalizeToolNames('Docs', tools);
    for (const tool of named) {
      const estimate = estimateToolTokens(tool);
      expect(Number.isInteger(estimate), tool.name).toBe(true);
      expect(estimate, tool.name).toBeGreaterThan(0);
      // The definition text the model carries: name, description and schema.
      expect(estimate, tool.name).toBeGreaterThanOrEqual(countTokens(`${tool.fnName}\n${tool.description}`));
    }
    // The estimate tracks the actual definition: a longer schema is more tokens.
    const search = named.find((tool) => tool.name === 'docs.search')!;
    const bare = { ...search, inputSchema: {}, fnName: search.fnName };
    expect(estimateToolTokens(bare)).toBeLessThan(estimateToolTokens(search));
    // It is the normalized model-facing name that counts, not the server's raw name.
    expect(estimateToolTokens({ ...search, fnName: search.fnName })).toBe(estimateToolTokens(search));
    expect(estimateToolTokens({ ...search, fnName: 'x' })).not.toBe(estimateToolTokens(search));
  });

  it('names every tool with a unique OpenRouter-safe function name and can reverse it', () => {
    const tools = [
      { name: 'docs.search', description: '', readOnly: true, inputSchema: {}, schemaBytes: 2 },
      { name: 'docs!search', description: '', readOnly: false, inputSchema: {}, schemaBytes: 2 },
      { name: 'x'.repeat(120), description: '', readOnly: false, inputSchema: {}, schemaBytes: 2 },
    ];
    const named = normalizeToolNames('GitHub (read only)', tools);
    expect(named.map((tool) => tool.fnName)).toEqual([...new Set(named.map((tool) => tool.fnName))]);
    for (const tool of named) {
      expect(tool.fnName).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(reverseToolName(named, tool.fnName)).toBe(tool.name);
    }
    expect(named[0].fnName).toContain('docs_search');
    expect(reverseToolName(named, 'nope')).toBeNull();
  });
});
