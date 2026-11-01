/**
 * Turning a real MCP failure class into words a person can act on. The server
 * already stores a readable sentence for every failure (`lastError`) and names the
 * class on the test answer; this maps that class to a plain explanation and the one
 * retry that can actually help. Nothing is invented: when the class is unknown the
 * server's own sentence is shown unchanged.
 */
import type { McpErrorCode } from '@/src/types/mcp.types';

/** Where a retry belongs: the token, the connection attempt itself, or neither. */
export type McpRetry = 'token' | 'attempt' | 'none';

export interface McpFailureGuide {
  /** The explanation to show, always in plain words. */
  message: string;
  /** What a retry would do, so the button can say so honestly. */
  retry: McpRetry;
  /** The button label for the retry. */
  action: string;
}

const GUIDES: Record<McpErrorCode, Omit<McpFailureGuide, 'message'> & { advice?: string }> = {
  unauthorized: { retry: 'token', action: 'Try another token', advice: 'Check the token and paste it again.' },
  not_found: { retry: 'attempt', action: 'Try again', advice: 'Nothing is answering the MCP endpoint at that URL.' },
  unreachable: { retry: 'attempt', action: 'Try again', advice: 'The server could not be reached from here.' },
  timeout: { retry: 'attempt', action: 'Try again', advice: 'The server took too long to answer.' },
  cancelled: { retry: 'attempt', action: 'Try again', advice: 'The attempt was stopped before it finished.' },
  blocked_address: { retry: 'none', action: 'Try again', advice: 'That address is private or blocked, so this deployment will not connect to it.' },
  invalid_url: { retry: 'none', action: 'Try again', advice: 'That URL is not one ChatterStack can connect to.' },
  response_too_large: { retry: 'attempt', action: 'Try again', advice: 'The server sent an answer bigger than the limit.' },
  too_many_tools: { retry: 'none', action: 'Try again', advice: 'It offers more tools than one connection may hold.' },
  oversized_schema: { retry: 'none', action: 'Try again', advice: 'One of its tools sends a schema larger than the limit, so nothing was stored.' },
  unsupported_schema: { retry: 'none', action: 'Try again', advice: 'One of its tools uses an input schema the model cannot be given.' },
  protocol: { retry: 'attempt', action: 'Try again', advice: 'The server did not speak MCP as expected.' },
  tool_failed: { retry: 'attempt', action: 'Try again' },
  unknown: { retry: 'attempt', action: 'Try again' },
};

/**
 * `detail` is the server's own credential-free sentence for this failure; it is
 * always kept so the person can see exactly what the server said.
 */
export function describeMcpFailure(code: McpErrorCode | undefined, detail: string): McpFailureGuide {
  const guide = code ? GUIDES[code] : undefined;
  if (!guide) return { message: detail, retry: 'attempt', action: 'Try again' };
  const message = guide.advice ? `${guide.advice} The server said: ${detail}` : detail;
  return { message, retry: guide.retry, action: guide.action };
}
