/**
 * The tool-definition budget shown by the MCP management block. Estimates are
 * produced server-side per tool (see estimateToolTokens in the MCP client
 * service); this module only does the browser-side arithmetic, so the meter and
 * a test can share the exact same math.
 */
import type { McpConnectionView } from '@/src/types/mcp.types';

/**
 * What a single model request normally has to spend on MCP tool definitions
 * before it feels heavy. Everything on screen labels itself an estimate: this
 * is a display budget, not a billed limit.
 */
export const MCP_TOOL_DEFINITION_BUDGET_TOKENS = 8_000;

export interface McpMeterSegment {
  id: string;
  name: string;
  /** Sum of this server's enabled-tool estimates. */
  estimatedTokens: number;
}

export interface McpMeterState {
  segments: McpMeterSegment[];
  total: number;
  budget: number;
  /** Tokens above the budget; 0 while inside it. */
  overBy: number;
  /** Enabled tools that are counted but have no estimate stored yet. */
  unestimated: number;
}

/**
 * The tools this connection would actually put in front of the model: the
 * server is switched on, connected and reviewed, and the tool itself is on.
 * That is exactly the chat route's rule, so the meter and the model can never
 * drift apart (see chatConnections in src/lib/server/mcp-connections.ts; the
 * parity is pinned by the integration test "meters exactly the tool set the
 * model is offered" in tests/integration/mcp-chat-route.test.ts).
 */
export function modelFacingTools(connection: McpConnectionView): McpConnectionView['tools'] {
  if (!connection.enabled || connection.status !== 'connected' || connection.needsReview) return [];
  return connection.tools.filter((tool) => tool.enabled);
}

export function connectionMeterTokens(connection: McpConnectionView): number {
  return modelFacingTools(connection).reduce((sum, tool) => sum + (tool.estimatedTokens ?? 0), 0);
}

/**
 * One segment per connected server that contributes, plus the total against
 * the budget. A tool without an estimate still counts as enabled but adds no
 * tokens; it is surfaced through `unestimated` instead of a made-up number.
 */
export function buildMeterState(
  connections: readonly McpConnectionView[],
  budget: number = MCP_TOOL_DEFINITION_BUDGET_TOKENS,
): McpMeterState {
  const segments = connections
    .map((connection) => ({ id: connection.id, name: connection.name, estimatedTokens: connectionMeterTokens(connection) }))
    .filter((segment) => segment.estimatedTokens > 0);
  const total = segments.reduce((sum, segment) => sum + segment.estimatedTokens, 0);
  const unestimated = connections.reduce(
    (sum, connection) => sum + modelFacingTools(connection).filter((tool) => tool.estimatedTokens === null).length,
    0,
  );
  return { segments, total, budget, overBy: Math.max(0, total - budget), unestimated };
}

const numberFormat = new Intl.NumberFormat('en-US');

export const formatMeterTokens = (value: number): string => numberFormat.format(value);

/** The meter's accessible value, e.g. "6,400 of 8,000 budgeted tokens (estimated)". */
export function meterValueText(state: McpMeterState): string {
  const base = `${formatMeterTokens(state.total)} of ${formatMeterTokens(state.budget)} budgeted tokens (estimated)`;
  return state.overBy > 0 ? `${base}, ${formatMeterTokens(state.overBy)} over budget` : base;
}
