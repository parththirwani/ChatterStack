/// <reference types="vite/client" />
/**
 * Project-fit regression guard for the MCP servers block.
 *
 * The block is spread over a page, five components and a removal hook, so the rules
 * that keep it inside the codebase are easy to break one file at a time without
 * any behavioural test noticing. Each rule here reads the real source text and
 * fails on the drift it forbids:
 *
 *  - no server code, no raw fetch and no hand-rolled switch in the browser;
 *  - motion only through the shared arc tokens, always quiet under
 *    prefers-reduced-motion;
 *  - announcements only through useAnnouncements, only polite;
 *  - the token budget lives in src/lib/client/mcp-budget.ts, never inline;
 *  - the directory reads the credential-free catalog config, which is allowed
 *    in the browser precisely because it imports nothing.
 */
import { describe, expect, it } from 'vitest';

const block = import.meta.glob<string>('/src/components/customize/ConnectionsPage.tsx', { query: '?raw', import: 'default', eager: true });
const parts = import.meta.glob<string>('/src/components/customize/connections/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
const clientLibs = import.meta.glob<string>('/src/lib/client/mcp*.ts', { query: '?raw', import: 'default', eager: true });

const sources: Record<string, string> = { ...block, ...parts };
const names = Object.keys(sources).map((file) => file.replace('/src/components/customize/', ''));

const read = (file: string) => sources[`/src/components/customize/${file}`];
const everyFile = () => names.map((file) => [file, read(file)] as const);

/** Files whose lines contain the given text, so a failure names the culprit. */
const filesMatching = (pattern: RegExp) => everyFile().filter(([, text]) => pattern.test(text)).map(([file]) => file);

describe('the MCP servers block stays inside the project conventions', () => {
  it('is made of the page, five components and the removal hook', () => {
    expect(names.sort()).toEqual([
      'ConnectionsPage.tsx',
      'connections/AddServerSheet.tsx',
      'connections/ContextMeter.tsx',
      'connections/HideOnNarrow.tsx',
      'connections/ServerRow.tsx',
      'connections/UndoBar.tsx',
      'connections/useUndoableRemoval.ts',
    ]);
  });

  it('imports no server module and calls no endpoint directly', () => {
    const banned = [
      { pattern: /from ['"]@\/src\/lib\/server\//, why: 'server-only lib' },
      { pattern: /from ['"]@\/src\/lib\/prisma['"]/, why: 'database client' },
      { pattern: /from ['"]server-only['"]/, why: 'server-only marker' },
      { pattern: /from ['"]next\/(headers|auth)/, why: 'server request context' },
      { pattern: /\bfetch\(/, why: 'raw fetch - go through src/lib/client/mcp.ts' },
      { pattern: /\/api\/mcp\//, why: 'endpoint path - it belongs to src/lib/client/mcp.ts' },
    ];
    for (const { pattern, why } of banned) {
      expect(filesMatching(pattern), `${why} reached the browser`).toEqual([]);
    }
    expect(read('ConnectionsPage.tsx')).toContain("import { updateMcpConnection, useMcpConnections } from '@/src/lib/client/mcp'");
    expect(read('connections/useUndoableRemoval.ts')).toContain("from '@/src/lib/client/mcp'");
  });

  it('keeps every MCP shape in src/types so server and UI share one view', () => {
    expect(filesMatching(/^\s*(?:export\s+)?(?:interface|type)\s+Mcp\w+/m), 'a component re-declared an MCP shape').toEqual([]);
    for (const [file, text] of everyFile()) {
      if (!/\bMcp(ConnectionView|ToolView|ErrorCode|TestResult)\b/.test(text)) continue;
      expect(text, `${file} uses an MCP shape without importing it from src/types`).toContain("from '@/src/types/mcp.types'");
    }
  });

  it('animates with the shared arc motion tokens instead of local springs', () => {
    const animated = filesMatching(/from 'motion\/react'/);
    expect(animated.length).toBeGreaterThan(0);
    for (const file of animated) {
      expect(read(file), `${file} animates without the arc tokens`).toContain("import { motionTokens } from '@/src/components/arc/lib/motion-tokens'");
    }
    expect(filesMatching(/visualDuration\s*:/), 'a literal spring was written by hand').toEqual([]);
    expect(filesMatching(/stiffness\s*:/)).toEqual([]);
    expect(filesMatching(/bounce\s*:/)).toEqual([]);
    expect(filesMatching(/duration:\s*(?!0\b)[0-9]/), 'a JS animation duration was hardcoded instead of motionTokens.duration').toEqual([]);
  });

  it('checks every motion transition against prefers-reduced-motion', () => {
    for (const [file, text] of everyFile()) {
      const lines = text.split('\n');
      const unguarded = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /transition=\{/.test(line) && !/reduceMotion/.test(line))
        .map(({ index }) => index + 1);
      expect(unguarded, `${file} animates for users who asked for reduced motion` ).toEqual([]);
    }
  });

  it('announces only through the shared polite regions', () => {
    expect(read('ConnectionsPage.tsx')).toContain("import { useAnnouncements } from '@/src/hooks/useAnnouncements'");
    const page = read('ConnectionsPage.tsx');
    expect(page.match(/aria-live="polite"/g) ?? [], 'the page parks exactly two polite regions').toHaveLength(2);
    expect(page).not.toContain('aria-live="assertive"');
    expect(filesMatching(/aria-live/), 'a component grew its own live region').toEqual(['ConnectionsPage.tsx']);
    expect(filesMatching(/announce\(/).sort()).toEqual([
      'ConnectionsPage.tsx',
      'connections/AddServerSheet.tsx',
      'connections/ServerRow.tsx',
      'connections/useUndoableRemoval.ts',
    ]);
  });

  it('keeps the tool-definition budget in one place', () => {
    const budget = clientLibs['/src/lib/client/mcp-budget.ts'];
    expect(budget).toMatch(/export const MCP_TOOL_DEFINITION_BUDGET_TOKENS = 8_000;/);
    expect(budget).toMatch(/budget: number = MCP_TOOL_DEFINITION_BUDGET_TOKENS/);
    expect(budget).toContain('modelFacingTools(connection)');
    expect(filesMatching(/8_?000/), 'a component repeated the budget number').toEqual([]);
  });

  it('uses the arc switch instead of a hand-rolled control', () => {
    const withSwitch = filesMatching(/<Switch/);
    expect(withSwitch).toEqual(['connections/ServerRow.tsx']);
    for (const file of withSwitch) {
      expect(read(file)).toContain("import { Switch } from '@/src/components/arc/switch/switch'");
    }
    expect(filesMatching(/role="switch"/)).toEqual([]);
  });

  it('reads the credential-free catalog config, which is browser-safe because it imports nothing', () => {
    const catalog = Object.entries(import.meta.glob<string>('/src/config/mcp-catalog.ts', { query: '?raw', import: 'default', eager: true }))[0];
    expect(catalog?.[1]).toBeDefined();
    expect(catalog?.[1]).not.toMatch(/^import /m);
    expect(read('connections/AddServerSheet.tsx')).toContain("import { MCP_CATALOG, type McpCatalogEntry } from '@/src/config/mcp-catalog'");
    expect(read('connections/AddServerSheet.tsx')).toContain('catalogAuthLabel');
  });

  it('follows the customize page pattern for tabs and navigation', () => {
    expect(read('ConnectionsPage.tsx')).toContain("import CustomizeTabs from './CustomizeTabs'");
    expect(read('ConnectionsPage.tsx')).toContain('<CustomizeTabs');
  });
});
