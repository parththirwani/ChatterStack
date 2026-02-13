import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/src/lib/auth';

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

/**
 * Higher-order function to wrap route handlers with authentication
 */
export function withAuth<T extends unknown[]>(
  handler: (request: NextRequest, userId: string, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return handler(request, session.user.id, ...args);
  };
}