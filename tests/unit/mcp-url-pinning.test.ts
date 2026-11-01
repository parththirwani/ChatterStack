import { describe, expect, it, vi } from 'vitest';

const agentOptions = vi.hoisted(() => ({ connect: null as Record<string, unknown> | null }));
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: { connect: Record<string, unknown> }) { agentOptions.connect = options.connect; }
    async close() {}
  },
  fetch: vi.fn(),
}));

import { createSafeFetch } from '@/src/lib/server/mcp-url';

describe('MCP DNS pinning', () => {
  it('hands the checked public address to the socket lookup and refuses a later private answer', async () => {
    let address = '93.184.216.34';
    const transportFetch = vi.fn(async (_url: string, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response('ok');
    });
    const safeFetch = createSafeFetch({
      maxResponseBytes: 1024,
      resolveAddresses: async () => [address],
      transportFetch,
    });

    await safeFetch('https://mcp.example.com/mcp');
    expect(transportFetch).toHaveBeenCalledTimes(1);
    expect(transportFetch.mock.calls[0]?.[1]).toHaveProperty('dispatcher');

    const lookup = agentOptions.connect?.lookup as (
      hostname: string,
      options: { all: boolean },
      callback: (error: Error | null, addresses: { address: string; family: number }[]) => void,
    ) => void;
    let selected: { address: string; family: number }[] = [];
    lookup('mcp.example.com', { all: true }, (error, addresses) => {
      expect(error).toBeNull();
      selected = addresses;
    });
    expect(selected).toEqual([{ address: '93.184.216.34', family: 4 }]);

    address = '127.0.0.1';
    await expect(safeFetch('https://mcp.example.com/mcp')).rejects.toMatchObject({ code: 'blocked_address' });
    expect(transportFetch).toHaveBeenCalledTimes(1);
    await safeFetch.close();
  });
});
