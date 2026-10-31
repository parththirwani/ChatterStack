import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpDisabledError, assertMcpToolsEnabled, mcpMode, mcpToolsEnabled } from '@/src/lib/api/chat/mcp-config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the MCP feature flag', () => {
  it.each([[''], ['off'], ['no'], ['enabled'], ['once']])('%j counts as off', (value) => {
    vi.stubEnv('MCP_TOOLS', value);
    expect(mcpMode()).toBe('off');
    expect(mcpToolsEnabled()).toBe(false);
  });

  it('turns on with ON in any case, with or without spaces', () => {
    for (const value of ['on', 'ON', '  On  ']) {
      vi.stubEnv('MCP_TOOLS', value);
      expect(mcpMode(), value).toBe('on');
      expect(mcpToolsEnabled(), value).toBe(true);
    }
  });

  it('refuses tool work while it is off', () => {
    vi.stubEnv('MCP_TOOLS', '');
    expect(() => assertMcpToolsEnabled()).toThrowError(McpDisabledError);
    vi.stubEnv('MCP_TOOLS', 'on');
    expect(() => assertMcpToolsEnabled()).not.toThrow();
  });
});
