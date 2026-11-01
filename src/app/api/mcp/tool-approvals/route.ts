import { z } from 'zod';
import { submitDecision } from '@/src/lib/server/tool-approvals';
import { invalid, readJson, sessionUserId, unauthorized } from '@/src/lib/server/mcp-routes';

// The id comes from the approval_request SSE event, so a decision can only be
// spent by the user whose pending call it is, and only once.
const decisionSchema = z.object({
  approvalId: z.string().min(8).max(64),
  conversationId: z.string().min(1).max(64).optional(),
  decision: z.enum(['approved', 'denied']),
});

export async function POST(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = decisionSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalid(parsed.error);
  const outcome = await submitDecision({
    id: parsed.data.approvalId,
    conversationId: parsed.data.conversationId,
    userId,
    decision: parsed.data.decision,
  });
  if (outcome === 'recorded') return Response.json({ ok: true, decision: parsed.data.decision });
  if (outcome === 'forbidden') return Response.json({ error: 'That approval is not yours.' }, { status: 403 });
  if (outcome === 'expired') return Response.json({ error: 'That approval has expired.' }, { status: 410 });
  return Response.json({ error: 'That approval was already decided or has ended.' }, { status: 404 });
}
