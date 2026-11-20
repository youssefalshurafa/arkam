import { NextResponse, type NextRequest } from 'next/server';

// Next 16 "proxy" (formerly middleware). One job: CSRF defence for the API.
//
// Every custom API route authenticates by the NextAuth session cookie, which the browser
// attaches to cross-site requests too (SameSite=Lax still allows top-level form POSTs, and
// several routes accept multipart form data — a CORS "simple" request needing no preflight).
// Browsers always send an Origin header on cross-site POST/PUT/PATCH/DELETE, so a state-
// changing request whose Origin isn't this site is refused here before any route runs.
//
// Requests WITHOUT an Origin header are let through: browsers only omit it for same-origin
// navigations and non-browser clients (curl, server-to-server), neither of which can ride a
// victim's cookies. NextAuth's own endpoints keep their built-in CSRF token on top of this.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function allowedOrigins(request: NextRequest): Set<string> {
 const origins = new Set<string>([request.nextUrl.origin]);
 const configured = process.env.NEXTAUTH_URL?.trim();
 if (configured) {
  try {
   origins.add(new URL(configured).origin);
  } catch {
   /* ignore malformed config */
  }
 }
 // Behind Vercel's proxy the forwarded host is the one the browser actually used.
 const forwardedHost = request.headers.get('x-forwarded-host');
 if (forwardedHost) {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  origins.add(`${proto}://${forwardedHost}`);
 }
 return origins;
}

export function proxy(request: NextRequest) {
 if (SAFE_METHODS.has(request.method)) {
  return NextResponse.next();
 }

 const origin = request.headers.get('origin');
 if (origin && !allowedOrigins(request).has(origin)) {
  return NextResponse.json({ error: 'Cross-site request blocked.' }, { status: 403 });
 }

 return NextResponse.next();
}

export const config = {
 matcher: '/api/:path*',
};
