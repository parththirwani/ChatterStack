import { MCP_CATALOG } from '@/src/config/mcp-catalog';
import { sessionUserId, unauthorized } from '@/src/lib/server/mcp-routes';

/** Catalog metadata only: prefilled URLs and their auth needs, never credentials. */
export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  return Response.json({ catalog: MCP_CATALOG });
}
