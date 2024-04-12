/**
 * Middleware to handle authentication for Next.js requests.
 *
 * Redirects unauthenticated users to the login page if trying to access protected routes.
 * Redirects authenticated users to the dashboard page from the home page.
 * Allows the request to continue if no redirect conditions are met.
 */
import {getToken} from 'next-auth/jwt'
import type {NextRequest} from 'next/server'
import {NextResponse} from 'next/server'

export async function middleware(request: NextRequest) {
  const session = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET
  })
  const url = request.nextUrl.clone()

  if (
    url.pathname.startsWith('/dashboard') ||
    url.pathname.startsWith('/measurementshub') ||
    url.pathname.startsWith('/properties') ||
    url.pathname.startsWith('/admin')
  ) {
    if (!session) {
      // If user is not authenticated and tries to access protected routes, redirect to login
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
  } else if (url.pathname === '/') {
    // Redirect from home to dashboard if authenticated, or login if not
    if (!session) {
      url.pathname = '/login'
    } else {
      url.pathname = '/dashboard'
    }
    return NextResponse.redirect(url)
  }

  // Allow request to continue if no conditions are met
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/dashboard',
    '/measurementshub',
    '/properties',
    '/admin'
  ]
}
