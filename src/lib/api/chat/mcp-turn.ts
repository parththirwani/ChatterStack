/**
 * Turns a user's enabled, reviewed MCP connections into the tool set one chat
 * turn may offer the model. Discovery runs at turn start (schemas are never
 * stored), every list is re-checked against the per-user allowlist, and tokens
 * stay server-side: the browser only ever sees normalized names and arguments.
 */
import { chatConnections, endpointFor, enabledToolsFor, type McpConnectionRow } from '@/src/lib/server/mcp-connections';
import { callMcpTool, discoverNormalizedTools, type McpEndpoint } from '@/src/lib/server/mcp-client';
import { trustedOriginsFromEnv } from '@/src/lib/server/mcp-url';
import { createApproval, waitForDecision } from '@/src/lib/server/tool-approvals';
import { redactedErrorText } from '@/src/lib/server/mcp-redact';
import { MAX_OFFERED_TOOLS } from './mcp-config';
import type {
  LoopTool,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolExecutionResult,
} from './tool-loop';
import type { MessageToolCallView, SSEData } from '@/src/types/chat.types';

export interface McpApprovalRequestPayload {
  approvalId: string;
  callId: string;
  name: string;
  toolId: string;
  connectionId: string;
  arguments: Record<string, unknown>;
  round: number;
  expiresAt: number;
}

export interface McpTurnInput {
  userId: string;
  conversationId: string;
  signal: AbortSignal;
  send: (event: SSEData) => void;
}

export interface McpTurn {
  tools: LoopTool[];
  isToolEnabled: (tool: LoopTool) => boolean;
  requestApproval: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  execute: (tool: LoopTool, callId: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolExecutionResult>;
}

const isEnabled = (row: McpConnectionRow) => new Set(enabledToolsFor(row).map((tool) => tool.name));

/**
 * Loads the connections and discovers their tools. A connection that fails to
 * list is reported through `toolDiscoveryFailed` and skipped: one broken
 * server must not stop the chat or hide the healthy ones.
 */
export async function prepareMcpTurn(input: McpTurnInput): Promise<McpTurn> {
  const rows = await chatConnections(input.userId);
  const allowedOrigins = trustedOriginsFromEnv();
  const endpoints = new Map<string, McpEndpoint>();
  const allowlists = new Map<string, Set<string>>();
  const tools: LoopTool[] = [];

  for (const row of rows) {
    if (tools.length >= MAX_OFFERED_TOOLS) break;
    const endpoint = endpointFor(row);
    endpoints.set(row.id, endpoint);
    allowlists.set(row.id, isEnabled(row));
    try {
      const discovered = await discoverNormalizedTools(endpoint, row.name, {
        signal: input.signal,
        allowedOrigins,
      });
      for (const tool of discovered) {
        if (tools.length >= MAX_OFFERED_TOOLS) break;
        if (!allowlists.get(row.id)?.has(tool.name)) continue;
        // Slugified prefixes can collide between differently named servers;
        // the model must never see one function name twice.
        if (tools.some((offered) => offered.name === tool.fnName)) continue;
        tools.push({
          name: tool.fnName,
          description: tool.description,
          parameters: tool.inputSchema,
          connectionId: row.id,
          toolId: tool.name,
        });
      }
    } catch (error) {
      input.send({
        toolDiscoveryFailed: {
          connectionId: row.id,
          error: redactedErrorText(error, [endpoint.token]),
        },
      });
    }
  }

  return {
    tools,
    isToolEnabled: (tool) => allowlists.get(tool.connectionId)?.has(tool.toolId) === true,
    async requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
      const approval = await createApproval({
        userId: input.userId,
        conversationId: input.conversationId,
        callId: request.callId,
        connectionId: request.connectionId,
        toolId: request.toolId,
        name: request.name,
        arguments: request.arguments,
        round: request.round,
      });
      const payload: McpApprovalRequestPayload = {
        approvalId: approval.id,
        callId: request.callId,
        name: request.name,
        toolId: request.toolId,
        connectionId: request.connectionId,
        arguments: request.arguments,
        round: request.round,
        expiresAt: approval.expiresAt,
      };
      input.send({ toolApprovalRequest: payload });
      const outcome = await waitForDecision(approval, { signal: request.signal });
      if (outcome === 'cancelled') throw new DOMException('The user stopped this turn.', 'AbortError');
      return outcome === 'approved' ? 'approved' : outcome === 'denied' ? 'denied' : 'expired';
    },
    async execute(tool, _callId, args, signal): Promise<ToolExecutionResult> {
      const endpoint = endpoints.get(tool.connectionId);
      if (!endpoint) return { ok: false, error: 'That MCP connection is no longer part of this turn.' };
      const content = await callMcpTool(endpoint, tool.toolId, args, { signal, allowedOrigins });
      return { ok: true, content };
    },
  };
}

export function toolCallEvent(call: MessageToolCallView): SSEData {
  return call.status === 'completed' ? { toolCallResult: call } : { toolCallFailure: call };
}
