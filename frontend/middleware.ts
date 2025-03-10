/**
 * Middleware to handle authentication for Next.js requests.
 *
 * Redirects unauthenticated users to the login page if trying to access protected routes.
 * Redirects authenticated users to the dashboard page from the home page.
 * Allows the request to continue if no redirect conditions are met.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import NextAuth from 'next-auth';
import authConfig from './auth.config';

const { auth: nextAuthMiddleware } = NextAuth(authConfig);

export default auth(async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.includes('/api/customsignin')) return NextResponse.next();

  const url = request.nextUrl.clone();
  const session = await nextAuthMiddleware(); // Fetch session once

  const isAuthenticated = !!session;
  const isProtectedRoute = ['/dashboard', '/measurementshub', '/fixeddatainput'].some(route => url.pathname.startsWith(route));

  if (isProtectedRoute && !isAuthenticated) {
    // Redirect unauthenticated users trying to access protected routes
    if (url.pathname !== '/login') {
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  } else if (url.pathname === '/') {
    // Redirect from home to dashboard if authenticated, otherwise to login
    if (isAuthenticated) {
      url.pathname = '/dashboard';
    } else {
      url.pathname = '/login';
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next(); // Allow request to continue if no conditions are met
});

export const config = {
  matcher: ['/', '/dashboard/:path*', '/measurementshub/:path*', '/fixeddatainput/:path*']
};
