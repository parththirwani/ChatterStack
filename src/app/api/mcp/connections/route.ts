import { z } from 'zod';
import { createConnection, listConnections, MAX_MCP_CONNECTIONS_PER_USER, MAX_MCP_NAME } from '@/src/lib/server/mcp-connections';
import { invalid, mcpErrorResponse, mcpGuard, readJson, sessionUserId, unauthorized } from '@/src/lib/server/mcp-routes';

const nameSchema = z.string().trim().min(1, 'Give this connection a name.').max(MAX_MCP_NAME, `Keep the name under ${MAX_MCP_NAME} characters.`);

// A connection starts off and untested: adding one never advertises a tool.
const createSchema = z
  .object({
    name: nameSchema,
    url: z.string().trim().max(2_048, 'That URL is too long.').optional(),
    catalogId: z.string().trim().max(64).optional(),
    token: z.string().max(4_096, 'That token is too long.').nullish(),
  })
  .refine((value) => Boolean(value.url) !== Boolean(value.catalogId), {
    message: 'Give either a URL or a catalog entry.',
    path: ['url'],
  });

export const maxDuration = 30;

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  return Response.json({ connections: await listConnections(userId), limit: MAX_MCP_CONNECTIONS_PER_USER });
}

export async function POST(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalid(parsed.error);
  const { name, url, catalogId, token } = parsed.data;
  try {
    return Response.json({ connection: await createConnection(userId, { name, url, catalogId, token }, mcpGuard()) }, { status: 201 });
  } catch (error) {
    return mcpErrorResponse(error);
  }
}
