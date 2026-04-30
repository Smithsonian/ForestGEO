/**
 * Edge-runtime authentication gate.
 *
 * Imports ONLY the lightweight auth.config (no DB mappers, no App Insights,
 * no Node-only modules). NextAuth v5's documented split: middleware uses
 * auth.config; full callbacks live in auth.ts and run in Node-runtime
 * route handlers / server components.
 *
 * Behavior:
 * - /api/health and /api/customsignin are public.
 * - In E2E mode (NEXT_PUBLIC_E2E_TESTING=true AND NODE_ENV !== 'production')
 *   middleware is bypassed so Cypress can mock auth client-side.
 * - Unauthenticated requests to protected pages → redirect to /login.
 * - Authenticated requests to / → redirect to /dashboard.
 * - Otherwise → continue.
 */

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import authConfig from './auth.config';

const { auth } = NextAuth(authConfig);

export default auth(req => {
  const { pathname } = req.nextUrl;

  if (pathname === '/api/health') return NextResponse.next();
  if (pathname.includes('/api/customsignin')) return NextResponse.next();

  if (process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  const isAuthenticated = !!req.auth;
  const isProtectedPage = ['/admin', '/dashboard', '/measurementshub', '/fixeddatainput'].some(route => pathname.startsWith(route));

  if (isProtectedPage && !isAuthenticated) {
    if (pathname !== '/login') {
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  } else if (pathname === '/') {
    url.pathname = isAuthenticated ? '/dashboard' : '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/', '/admin/:path*', '/dashboard/:path*', '/measurementshub/:path*', '/fixeddatainput/:path*', '/api/health']
};
