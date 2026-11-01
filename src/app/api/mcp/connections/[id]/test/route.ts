import { testConnection } from '@/src/lib/server/mcp-connections';
import { mcpErrorResponse, mcpGuard, notFound, sessionUserId, unauthorized } from '@/src/lib/server/mcp-routes';

type Context = { params: Promise<{ id: string }> };

// Discovery can take a moment on a cold server, and the result is stored on the
// row either way: a failure becomes a visible connection error, not a 500.
export const maxDuration = 30;

export async function POST(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  try {
    const result = await testConnection(userId, (await context.params).id, mcpGuard());
    return result ? Response.json(result) : notFound();
  } catch (error) {
    return mcpErrorResponse(error);
  }
}
