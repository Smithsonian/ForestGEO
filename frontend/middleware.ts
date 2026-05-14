/**
 * Edge-runtime authentication gate.
 *
 * Imports ONLY the lightweight auth.config (no DB mappers, no App Insights,
 * no Node-only modules). NextAuth v5's documented split: middleware uses
 * auth.config; full callbacks live in auth.ts and run in Node-runtime
 * route handlers / server components.
 *
 * Behavior:
 * - In E2E mode (NEXT_PUBLIC_E2E_TESTING=true AND NODE_ENV !== 'production')
 *   middleware is bypassed so Cypress can mock auth client-side.
 * - Public API routes listed below pass through without auth.
 * - Unauthenticated requests to /api/* return 401 JSON (not a redirect).
 * - Unauthenticated requests to protected pages → redirect to /login.
 * - Authenticated requests to / → redirect to /dashboard.
 * - Otherwise → continue.
 */

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import authConfig from './auth.config';

const { auth } = NextAuth(authConfig);

function isPathOrChild(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === '/api/health' ||
    pathname === '/api/clearallcookies' ||
    pathname === '/api/diagnostics/streaming-timeout' ||
    isPathOrChild(pathname, '/api/animations') ||
    isPathOrChild(pathname, '/api/auth') ||
    isPathOrChild(pathname, '/api/customsignin')
  );
}

export default auth(req => {
  const { pathname } = req.nextUrl;

  if (process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  if (isPublicApiPath(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith('/api/');
  const isAuthenticated = !!req.auth;

  if (isApi && !isAuthenticated) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  const isProtectedPage = ['/admin', '/dashboard', '/measurementshub', '/fixeddatainput'].some(route => pathname.startsWith(route));

  if (isProtectedPage && !isAuthenticated) {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  } else if (pathname === '/') {
    url.pathname = isAuthenticated ? '/dashboard' : '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  // Matches everything except Next.js internals and static assets.
  // _next/static and _next/image: build output. favicon.ico and image
  // extensions: static assets. Public allowlisting and unauthenticated
  // 401 handling for /api/* routes lives in the middleware body above.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)']
};
