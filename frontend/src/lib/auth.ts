import { getServerApiUrl } from '@/lib/api-url';
import { NextAuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';

/**
 * Pull a human-readable message out of a backend error body.
 *
 * The API's error envelope is `{ success, error: { code, message } }`. A
 * top-level `detail` only appears on FastAPI validation errors, and on
 * validation errors it is an array rather than a string. Both sign-in paths
 * used to read `detail` alone, so the pending-approval 403 — whose message sits
 * at `error.message` — read as an empty string and fell through to a generic
 * failure, telling a user awaiting approval that their password was wrong.
 */
function backendErrorMessage(body: unknown): string {
  const b = body as {
    error?: { message?: unknown };
    detail?: unknown;
    message?: unknown;
  } | null;
  for (const candidate of [b?.error?.message, b?.detail, b?.message]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return '';
}

declare module 'next-auth' {
  interface User {
    accessToken?: string;
    refreshToken?: string;
    role?: string;
  }

  interface Session {
    accessToken?: string;
    error?: string;
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
    role?: string;
    accessTokenExpires?: number;
    error?: string;
  }
}

// Warn once per process if NEXTAUTH_URL looks wrong in production.
let _nextauthUrlWarned = false;
if (process.env.NODE_ENV === 'production' && !_nextauthUrlWarned) {
  _nextauthUrlWarned = true;
  const url = process.env.NEXTAUTH_URL || '';
  if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
    console.error(
      `[auth] NEXTAUTH_URL is "${url}" — this will cause redirect_uri_mismatch with Google OAuth in production. ` +
      `Set NEXTAUTH_URL=https://your-production-domain.com and register ` +
      `https://your-production-domain.com/api/auth/callback/google in Google Cloud Console → ` +
      `APIs & Services → Credentials → Authorized redirect URIs.`
    );
  }
}

/**
 * Decode a JWT payload server-side without verifying the signature. Used by the
 * LIFF provider to read the user id (sub) and email out of the Aspiro access token
 * (already verified/issued by the backend), avoiding an extra round-trip.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** The token with a usable backend access token, refreshing it if it has expired. */
async function withLiveAccessToken(token: JWT, signal?: AbortSignal): Promise<JWT> {
  if (token.error === 'RefreshAccessTokenError') {
    return token;
  }

  if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
    return token;
  }

  if (token.refreshToken) {
    try {
      const apiUrl = getServerApiUrl();

      const response = await fetch(`${apiUrl}/auth/refresh`, {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token.refreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          ...token,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || token.refreshToken,
          accessTokenExpires: Date.now() + 15 * 60 * 1000,
        };
      } else {
        return { ...token, error: 'RefreshAccessTokenError' };
      }
    } catch {
      return { ...token, error: 'RefreshAccessTokenError' };
    }
  }

  return { ...token, error: 'RefreshAccessTokenError' };
}

export const authOptions: NextAuthOptions = {
  debug: false,
  logger: {
    error: (code, metadata) => {
      if (code === 'SIGNIN_OAUTH_ERROR' || code === 'SESSION_ERROR') {
        console.error(`[next-auth][error][${code}]`, metadata);
      }
    },
    warn: () => { },
    debug: () => { },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      id: 'demo',
      name: 'Demo',
      credentials: {},
      async authorize() {
        const demoEmail = process.env.DEMO_EMAIL;
        const demoPassword = process.env.DEMO_PASSWORD;
        if (!demoEmail || !demoPassword) return null;

        const apiUrl = getServerApiUrl();
        try {
          const response = await fetch(`${apiUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: demoEmail, password: demoPassword }),
          });
          if (!response.ok) return null;
          const data = await response.json();
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            image: data.user.avatar,
            role: data.user.role || 'USER',
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          };
        } catch {
          return null;
        }
      },
    }),
    /**
     * Password-less sign-in as any local account, for development only.
     *
     * Runs entirely server-side, which is the point: DEV_TOOLS_TOKEN is read
     * here and sent as a header, so the shared secret never reaches the
     * browser. The backend route is additionally gated on DEV_LOGIN_ENABLED, a
     * development ENVIRONMENT and a local database; if any of that is missing
     * the request 404s and authorize() returns null.
     */
    CredentialsProvider({
      id: 'dev',
      name: 'Developer',
      credentials: {
        email: { label: 'Email', type: 'email' },
      },
      async authorize(credentials) {
        if (process.env.DEV_LOGIN_ENABLED !== 'true') return null;
        const devToken = process.env.DEV_TOOLS_TOKEN;
        if (!devToken) return null;
        if (!credentials?.email) return null;

        const apiUrl = getServerApiUrl();
        try {
          const response = await fetch(`${apiUrl}/auth/dev-login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Dev-Tools-Token': devToken,
            },
            body: JSON.stringify({ email: credentials.email }),
          });
          if (!response.ok) return null;
          const data = await response.json();
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            image: data.user.avatar,
            role: data.user.role || 'USER',
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          };
        } catch {
          return null;
        }
      },
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const apiUrl = getServerApiUrl();
          const response = await fetch(`${apiUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            return {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              image: data.user.avatar,
              role: data.user.role || 'USER',
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
            };
          }
          if (response.status === 403) {
            const errData = await response.json().catch(() => ({}));
            if (backendErrorMessage(errData).toLowerCase().includes('pending')) {
              throw new Error('PendingApproval');
            }
          }
          return null;
        } catch (error) {
          if (error instanceof Error && error.message === 'PendingApproval') throw error;
          console.error('Auth error:', error);
          return null;
        }
      },
    }),
    CredentialsProvider({
      id: 'liff',
      name: 'LINE LIFF',
      credentials: {
        idToken: { label: 'LINE ID Token', type: 'text' },
      },
      // Called from the /liff bootstrapper inside LINE's in-app browser. Exchanges the
      // LINE ID token for an Aspiro session so the user becomes a first-class NextAuth
      // session (cookie) — required for the middleware-gated app routes the LIFF opens.
      async authorize(credentials) {
        const idToken = credentials?.idToken;
        if (!idToken) return null;

        const apiUrl = getServerApiUrl();
        try {
          const response = await fetch(`${apiUrl}/line-bot/liff/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken }),
          });
          if (!response.ok) return null;

          const json = await response.json();
          // Endpoint returns the ApiResponse envelope: { success, data, message }.
          const session = (json?.data ?? json) as {
            linked?: boolean;
            access_token?: string;
            display_name?: string;
          };
          // Unlinked LINE users have no Aspiro account — surface as a sign-in failure
          // so the /liff page shows the "type /link" call-to-action.
          if (!session?.linked || !session.access_token) return null;

          const claims = decodeJwtPayload(session.access_token);
          const userId = (claims?.sub as string) || '';
          if (!userId) return null;

          return {
            id: userId,
            email: (claims?.email as string) || null,
            name: session.display_name || null,
            role: (claims?.role as string) || 'USER',
            accessToken: session.access_token,
            // LIFF sessions aren't issued a refresh token: the session lives as long as
            // the access token, after which the user simply re-opens the LIFF app.
            refreshToken: undefined,
          };
        } catch (error) {
          console.error('[NextAuth] LIFF authorize failed:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (account && user) {
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.userId = user.id;
        token.role = user.role || 'USER';
        token.accessTokenExpires = Date.now() + 15 * 60 * 1000;
        delete token.error;
        return token;
      }

      return withLiveAccessToken(token);
    },
    async session({ session, token }) {
      if (token.error) {
        return {
          ...session,
          error: 'RefreshAccessTokenError',
          accessToken: undefined,
        };
      }

      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
        session.accessToken = token.accessToken;
      }
      return session;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        const apiUrl = getServerApiUrl();
        const callbackUrl = `${apiUrl}/auth/google/callback`;

        // Logged as warn so it appears in production logs for debugging
        console.warn(`[NextAuth] Google callback -> ${callbackUrl}`);

        try {
          const oauthToken = account.access_token || account.id_token;
          if (!oauthToken) {
            console.error('[NextAuth] Google sign-in: no access_token or id_token available');
            return '/auth/error?error=BackendUnavailable';
          }
          const requestData = {
            code: oauthToken,
            email: user.email || profile?.email,
            name: user.name || profile?.name,
            picture: user.image || (profile as Record<string, unknown>)?.picture,
            id: account.providerAccountId,
            verified_email: (profile as Record<string, unknown>)?.verified_email ?? true,
          };

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          let response: Response;
          try {
            response = await fetch(callbackUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'NextAuth/Google-OAuth',
              },
              body: JSON.stringify(requestData),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }

          const data = await response.json().catch(() => ({}));

          if (response.ok) {
            if (!data.access_token) {
              console.error(`[NextAuth] Backend 200 but no access_token. Response keys: ${Object.keys(data).join(',')}`);
              return '/auth/error?error=BackendUnavailable';
            }
            console.warn(`[NextAuth] Login OK — user=${data.user?.id || 'unknown'} role=${data.user?.role || 'USER'}`);
            user.accessToken = data.access_token;
            user.refreshToken = data.refresh_token;
            user.role = data.user?.role || 'USER';
            user.id = data.user?.id;
            return true;
          }

          if (
            response.status === 403 &&
            backendErrorMessage(data).toLowerCase().includes('pending')
          ) {
            return '/auth/pending-approval';
          }
          if (response.status >= 400 && response.status < 500) {
            return false;
          }

          console.error(`[NextAuth] Backend error ${response.status}: ${JSON.stringify(data)}`);
          return '/auth/error?error=BackendUnavailable';
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[NextAuth] Google sign-in failed (url=${callbackUrl}): ${msg}`);
          return '/auth/error?error=BackendUnavailable';
        }
      }
      return true;
    },
  },
  events: {
    // The refresh token never reaches page JavaScript, so it is revoked here,
    // server-side. Best-effort: a backend that is down must not strand the user
    // in a session they asked to end. If the refresh itself fails nothing is
    // revoked: a 401 means the token is already dead, an outage leaves it live.
    async signOut({ token }) {
      if (!token?.refreshToken) return;
      // Bounded, so a hung backend cannot hold up clearing the cookie.
      const live = await withLiveAccessToken(token, AbortSignal.timeout(3000));
      if (live.error) return;
      try {
        await fetch(`${getServerApiUrl()}/auth/logout`, {
          signal: AbortSignal.timeout(3000),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${live.accessToken}` },
          body: JSON.stringify({ refresh_token: live.refreshToken, logout_all_devices: false }),
        });
      } catch {
        /* best-effort */
      }
    },
  },
  pages: {
    signIn: '/auth/signin',
    signOut: '/',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

