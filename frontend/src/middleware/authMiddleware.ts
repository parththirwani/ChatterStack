import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/src/lib/auth';

export async function middleware(request: NextRequest) {
  const session = await auth();
  const isAuthPage = request.nextUrl.pathname.startsWith('/auth');
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');

  // Allow API routes to handle their own authentication
  if (isApiRoute) {
    return NextResponse.next();
  }

  // Redirect authenticated users away from auth pages
  if (isAuthPage && session) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Redirect unauthenticated users to sign in
  if (!isAuthPage && !session) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', request.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

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
export function withAuth(
  handler: (request: NextRequest, userId: string, ...args: any[]) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: any[]) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return handler(request, session.user.id, ...args);
  };
}
