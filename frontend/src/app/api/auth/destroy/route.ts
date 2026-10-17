import { NextResponse } from 'next/server';

/**
 * Emergency session cookie destroyer.
 * Returns a 200 HTML response (not a redirect) so browsers are guaranteed
 * to apply the Set-Cookie clear headers before navigating away.
 * A 307 redirect sometimes causes browsers to ignore Set-Cookie headers,
 * leaving the stale JWT cookie intact and causing an infinite loop.
 *
 * Cookie attributes must match the original cookie exactly (path, httpOnly,
 * sameSite) otherwise some browsers treat the clear as a different cookie
 * and ignore it. NextAuth defaults: httpOnly=true, sameSite=lax, path=/.
 */
export async function GET() {
  const isSecure = process.env.NEXTAUTH_URL?.startsWith('https') ?? false;

  // Base options matching NextAuth's default cookie attributes
  const cookieOptions = {
    path: '/',
    expires: new Date(0),
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecure,
  };

  // __Host- and __Secure- prefixed variants require secure=true (HTTPS only)
  const secureCookieOptions = {
    ...cookieOptions,
    secure: true,
  };

  const cookieList: Array<[string, typeof cookieOptions]> = [
    ['next-auth.session-token',                cookieOptions],
    ['__Secure-next-auth.session-token',       secureCookieOptions],
    ['next-auth.csrf-token',                   cookieOptions],
    ['__Host-next-auth.csrf-token',            secureCookieOptions],
    ['next-auth.callback-url',                 cookieOptions],
    ['__Secure-next-auth.callback-url',        secureCookieOptions],
    ['next-auth.pkce.code_verifier',           cookieOptions],
    ['__Secure-next-auth.pkce.code_verifier',  secureCookieOptions],
  ];

  const response = new NextResponse(
    `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=/auth/signin" />
  </head>
  <body>
    <script>window.location.replace('/auth/signin');</script>
  </body>
</html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }
  );

  for (const [name, options] of cookieList) {
    response.cookies.set(name, '', options);
  }

  return response;
}
