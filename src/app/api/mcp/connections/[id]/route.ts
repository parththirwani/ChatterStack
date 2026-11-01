import { z } from 'zod';
import { deleteConnection, getConnection, publicConnection, updateConnection, MAX_MCP_NAME } from '@/src/lib/server/mcp-connections';
import { invalid, mcpErrorResponse, notFound, readJson, sessionUserId, unauthorized } from '@/src/lib/server/mcp-routes';

type Context = { params: Promise<{ id: string }> };

// Any subset: rename, rotate the token, flip a tool switch, review the tool
// list, or turn the connection on and off.
const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'Give this connection a name.').max(MAX_MCP_NAME, `Keep the name under ${MAX_MCP_NAME} characters.`).optional(),
    token: z.string().max(4_096, 'That token is too long.').nullish(),
    clearToken: z.boolean().optional(),
    enabled: z.boolean().optional(),
    toolEnabled: z.record(z.string().max(200), z.boolean()).optional(),
    reviewTools: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change');

export async function GET(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const row = await getConnection(userId, (await context.params).id);
  return row ? Response.json({ connection: publicConnection(row) }) : notFound();
}

export async function PATCH(request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const connection = await updateConnection(userId, (await context.params).id, parsed.data);
    return connection ? Response.json({ connection }) : notFound();
  } catch (error) {
    return mcpErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  return (await deleteConnection(userId, (await context.params).id)) ? new Response(null, { status: 204 }) : notFound();
}
