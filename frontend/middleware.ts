import {getToken} from "next-auth/jwt";
import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";

export async function middleware(request: NextRequest) {
  const session = await getToken({req: request, secret: process.env.NEXTAUTH_SECRET});
  const url = request.nextUrl.clone();

  if (url.pathname.startsWith('/dashboard') ||
    url.pathname.startsWith('/coremeasurementhub') ||
    url.pathname.startsWith('/properties') ||
    url.pathname.startsWith('/admin')) {
    if (!session) {
      // If user is not authenticated and tries to access protected routes, redirect to login
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  } else if (url.pathname === '/') {
    // Redirect from home to dashboard if authenticated, or login if not
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Allow request to continue if no conditions are met
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard', '/coremeasurementhub', '/properties', '/admin']
}
