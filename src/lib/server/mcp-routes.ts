import { z } from 'zod';
import { McpConnectionError, type ConnectionGuard } from './mcp-connections';
import { McpError } from './mcp-client';
import { McpUrlError, trustedOriginsFromEnv } from './mcp-url';

/** Shared pieces of the /api/mcp routes. */

export { sessionUserId, unauthorized } from './route-auth';

export const notFound = () => Response.json({ error: 'MCP connection not found' }, { status: 404 });

export function invalid(error: z.ZodError) {
  const issue = error.issues[0];
  return Response.json(
    { error: issue?.message ?? 'Invalid MCP connection', field: issue ? String(issue.path[0]) : undefined, issues: error.issues },
    { status: 400 }
  );
}

/** Only origins the operator explicitly trusted are ever allowed off the public path. */
export function mcpGuard(): ConnectionGuard {
  return { allowedOrigins: trustedOriginsFromEnv() };
}

/** Turns an MCP failure into a response with the message the UI can show. */
export function mcpErrorResponse(error: unknown) {
  if (error instanceof McpConnectionError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof McpUrlError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof McpError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  throw error;
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
