import { getToken } from 'next-auth/jwt';
import type { JWT } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

/**
 * `getToken()` wrapper that never throws.
 *
 * next-auth v4 reads a `Bearer` Authorization header and passes the value to
 * `decodeURIComponent` *outside* its own try/catch (see next-auth/jwt/index.js —
 * the decode sits above the `try` that guards JWT verification). A header the
 * decoder rejects — `Authorization: Bearer %` is enough — raises a URIError that
 * escapes getToken and crashes the caller. Called from middleware that gates
 * nearly every route, that turns the whole authenticated surface into 500s for
 * any unauthenticated client. The advisory covers all of next-auth v4, so
 * upgrading is not a way out; the caller has to guard.
 *
 * Aspiro authenticates by NextAuth session cookie and never by Bearer, so a
 * header we cannot decode is simply not a session — treat any throw as "no
 * token" and let the caller redirect to sign-in as it would for an anonymous
 * request.
 */
const SECURE_SESSION_COOKIE = '__Secure-next-auth.session-token';

export async function safeGetToken(req: NextRequest): Promise<JWT | null> {
  try {
    // getToken picks the cookie name from NEXTAUTH_URL alone. When that is unset
    // (AUTH_TRUST_HOST, one dev server on both http://localhost and an HTTPS
    // Tailscale name) it would miss the __Secure- cookie, so follow the cookie.
    // A large JWT is split into `<name>.0`, `<name>.1`, … so match chunks too.
    const secureCookie = process.env.NEXTAUTH_URL
      ? undefined
      : req.cookies
          .getAll()
          .some((c) => c.name === SECURE_SESSION_COOKIE || c.name.startsWith(`${SECURE_SESSION_COOKIE}.`));
    return await getToken({ req, secret: process.env.NEXTAUTH_SECRET, secureCookie });
  } catch (error) {
    // A URIError is the known malformed-header case above: expected, attacker
    // controlled, and high volume — logging it would just hand over the logs.
    // Anything else is unexpected (a missing NEXTAUTH_SECRET throws here too),
    // so keep that visible rather than silently signing everyone out.
    if (!(error instanceof URIError)) {
      console.error('[auth] getToken failed:', error);
    }
    return null;
  }
}
