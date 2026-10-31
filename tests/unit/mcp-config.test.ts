import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APPROVAL_TTL_SECONDS,
  MAX_OFFERED_TOOLS,
  McpDisabledError,
  assertMcpToolsEnabled,
  mcpApprovalTtlSeconds,
  mcpMode,
  mcpToolsEnabled,
} from '@/src/lib/api/chat/mcp-config';
import { modelSupportsTools } from '@/src/config/models';

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

describe('the approval TTL and tool-capability config', () => {
  it('defaults the approval window and clamps a set one', () => {
    expect(mcpApprovalTtlSeconds()).toBe(DEFAULT_APPROVAL_TTL_SECONDS);
    vi.stubEnv('MCP_APPROVAL_TTL_SECONDS', '30');
    expect(mcpApprovalTtlSeconds()).toBe(30);
    vi.stubEnv('MCP_APPROVAL_TTL_SECONDS', '9999');
    expect(mcpApprovalTtlSeconds()).toBe(600);
    vi.stubEnv('MCP_APPROVAL_TTL_SECONDS', '0');
    expect(mcpApprovalTtlSeconds()).toBe(DEFAULT_APPROVAL_TTL_SECONDS);
    vi.stubEnv('MCP_APPROVAL_TTL_SECONDS', 'nonsense');
    expect(mcpApprovalTtlSeconds()).toBe(DEFAULT_APPROVAL_TTL_SECONDS);
  });

  it('caps the tools offered in one turn', () => {
    expect(MAX_OFFERED_TOOLS).toBeGreaterThan(0);
  });

  it('refuses tool calls for models outside the registry', () => {
    expect(modelSupportsTools('openai/gpt-4.1')).toBe(true);
    expect(modelSupportsTools('some/custom-not-registered')).toBe(false);
  });
});
