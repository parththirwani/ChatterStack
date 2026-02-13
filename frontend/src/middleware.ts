import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // No auth middleware - NextAuth handles auth at page/API level
  // This prevents the "custom" error
  return NextResponse.next();
}

export const config = {
  // Don't run middleware on static files or API auth routes
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth).*)',
  ],
};