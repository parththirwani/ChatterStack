import { NextResponse } from 'next/server';

/**
 * Enforce user scope - prevents cross-user data access
 */
export function enforceUserScope(
  authenticatedUserId: string,
  requestUserId: string
): { allowed: boolean; error?: NextResponse } {
  if (!authenticatedUserId) {
    return {
      allowed: false,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (requestUserId && requestUserId !== authenticatedUserId) {
    console.warn(
      `User ${authenticatedUserId} attempted to access user ${requestUserId}'s data`
    );
    return {
      allowed: false,
      error: NextResponse.json(
        { error: 'Forbidden: Cannot access other users\' data' },
        { status: 403 }
      ),
    };
  }

  return { allowed: true };
}
