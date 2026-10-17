import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { safeGetToken } from '@/lib/safe-get-token';
import { callbackPathFor } from '@/lib/safe-callback';

const PUBLIC_PATHS = [
  '/',
  '/auth/signin',
  // The sign-up page is /auth/signup. This list previously held
  // '/auth/register', which has no page behind it (404), so the allowlist
  // protected a route that does not exist while gating the real one — a
  // logged-out visitor clicking "Get Started" was bounced to /auth/signin and
  // could never create an account.
  '/auth/signup',
  '/auth/pending-approval',
  '/auth/error',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/privacy',
  '/terms',
  // LINE account linking — unauthenticated users must reach this page so the
  // page's own sign-in button can pass the token as a relative callbackUrl.
  // (This was first added because the middleware's callbackUrl used to be
  // absolute and got stripped to '/', losing the token; it is relative now, but
  // the page still owns its own sign-in flow.)
  '/link-line',
  // LIFF bootstrapper — opened inside LINE's in-app browser, where no NextAuth
  // session cookie exists yet. It must be reachable unauthenticated so it can run
  // liff.init(), read the LINE ID token, and mint a session (signIn('liff')).
  // Gating it bounces the user to /auth/signin (Google OAuth then dies in the
  // webview with disallowed_useragent) — the bot's "Open Aspiro" button would fail.
  '/liff',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // Next-auth internal routes and static files are always public
  if (pathname.startsWith('/api/auth/')) return true;
  // Creating an account is by definition unauthenticated. Without this the
  // POST was redirected to /auth/signin, and because a redirect to an HTML
  // page still resolves 200, the signup form read it as success and sent the
  // user to "pending approval" having created nothing at all.
  // Deliberately this one path, not /api/proxy/* — that would expose every
  // backend route to unauthenticated callers through the proxy.
  if (pathname === '/api/proxy/users/register') return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/favicon')) return true;
  // PWA / static assets served from /public must never be gated
  if (pathname.startsWith('/icons/')) return true;
  // Self-hosted fonts. Inter rides along under /_next/ because next/font emits
  // it there, but the Noto Sans TC subset files are plain /public assets — so
  // without this every CJK chunk 307s to /auth/signin and Chinese silently
  // falls back to a system face for anyone not signed in (the landing and
  // sign-in pages included).
  if (pathname.startsWith('/fonts/')) return true;
  if (pathname === '/manifest.json') return true;
  if (pathname === '/sw.js') return true;
  if (pathname === '/robots.txt') return true;
  if (pathname === '/sitemap.xml') return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Block debug/test pages in production
  if (process.env.NODE_ENV === 'production') {
    const isDebug = ['/test-', '/debug-', '/test/', '/debug/'].some(p => pathname.startsWith(p));
    if (isDebug) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // Public routes — no auth needed
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Allow demo-mode users through — the page layer enforces demo-only content
  const demoModeCookie = request.cookies.get('demo-mode');
  if (demoModeCookie?.value === 'true') {
    return NextResponse.next();
  }

  // Check for a valid NextAuth JWT. safeGetToken never throws — a malformed
  // Authorization header must read as "no session", not crash the middleware.
  const token = await safeGetToken(request);

  if (!token) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', callbackPathFor(request.nextUrl));
    return NextResponse.redirect(signInUrl);
  }

  // If the token has a refresh error the session is dead — send to signin
  if (token.error === 'RefreshAccessTokenError') {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', callbackPathFor(request.nextUrl));
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
