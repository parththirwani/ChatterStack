import crypto from 'node:crypto';

/**
 * Compare the `Authorization: Bearer <CRON_SECRET>` header without leaking
 * the secret through timing. Both sides are hashed first so the fixed-size
 * comparison cannot fail on a length mismatch (timingSafeEqual throws then).
 * Always false while CRON_SECRET is unset.
 */
export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length);
  const expectedDigest = crypto.createHash('sha256').update(secret).digest();
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}
