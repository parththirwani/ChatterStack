import { MCP_CATALOG } from '@/src/config/mcp-catalog';

/** Catalog metadata only: prefilled URLs and their auth needs, never credentials. */
export async function GET() {
  return Response.json({ catalog: MCP_CATALOG });
}
