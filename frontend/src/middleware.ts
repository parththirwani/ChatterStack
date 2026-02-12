import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/src/lib/auth';

export async function middleware(request: NextRequest) {
  const session = await auth();
  const isAuthPage = request.nextUrl.pathname.startsWith('/auth');
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');
  const isPublicFile = /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js)$/.test(request.nextUrl.pathname);

  // Allow public files and API routes to handle their own authentication
  if (isPublicFile || isApiRoute) {
    return NextResponse.next();
  }

  // Redirect authenticated users away from auth pages
  if (isAuthPage && session) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Redirect unauthenticated users to sign in (except auth pages)
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
     * - public files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth).*)',
  ],
};