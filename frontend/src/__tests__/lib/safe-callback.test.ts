/**
 * Where sign-in sends you afterwards.
 *
 * Two bugs, one helper. The middleware attached `request.url` as the
 * callbackUrl, which behind Caddy/the tunnel is `https://0.0.0.0:3000/...`; the
 * sign-in page refused it, so every deep link landed on `/`. And the page's own
 * guard was `startsWith('/')`, which `//evil.com` passes — the credentials
 * sign-in then `router.push`ed it to another site.
 */
import type { NextRequest } from 'next/server';

import { callbackPathFor, safeCallbackPath } from '@/lib/safe-callback';
import { middleware } from '@/middleware';
import { safeGetToken } from '@/lib/safe-get-token';

jest.mock('@/lib/safe-get-token', () => ({ safeGetToken: jest.fn() }));
// jsdom has no Fetch Response, and the redirect target is all these tests need.
jest.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ status: 200, location: null }),
    redirect: (url: URL) => ({ status: 307, location: url.toString() }),
  },
}));
const mockSafeGetToken = safeGetToken as jest.MockedFunction<typeof safeGetToken>;

describe('safeCallbackPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/link-line?token=abc', '/link-line?token=abc'],
    ['/transactions?wallet=life#top', '/transactions?wallet=life#top'],
  ])('keeps the same-site path %s', (raw, expected) => {
    expect(safeCallbackPath(raw)).toBe(expected);
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/dashboard'],
    ['backslash, which browsers read as a slash', '/\\evil.com'],
    ['tab smuggled between the slashes (the parser strips it)', '/\t/evil.com'],
    ['newline smuggled between the slashes', '/\n/evil.com'],
    ['carriage return smuggled between the slashes', '/\r/evil.com'],
    ['backslash after a smuggled tab', '/\t\\evil.com'],
    ['dot segment that normalises to //', '/.//evil.com'],
    ['parent segment that normalises to //', '/..//evil.com'],
    ['nested parent segment', '/a/..//evil.com'],
    ['percent-encoded dot segment', '/%2e//evil.com'],
    ['percent-encoded parent segment', '/%2E%2E//evil.com'],
    ['dot segment then backslash', '/./\\evil.com'],
    ['absolute to another host', 'https://evil.com/'],
    ['absolute to this host (what the middleware used to send)', 'https://0.0.0.0:3000/docs'],
    ['javascript: URL', 'javascript:alert(1)'],
    ['relative without a leading slash', 'dashboard'],
    ['empty', ''],
    ['missing', null],
  ])('falls back to / for %s', (_label, raw) => {
    expect(safeCallbackPath(raw)).toBe('/');
  });
});

describe('safeCallbackPath output', () => {
  // Whatever the input, the result is followed by router.push against the real
  // origin, so it must never read as protocol-relative there.
  const prefixes = ['/', '/.', '/..', '/a/..', '/%2e', '/%2E%2E', '/./', '/\t', '/\n', '/\r', '//', '/\\'];
  const middles = ['', '/', '\\', '\t/', '/\t', '%2f', '%5c'];
  const inputs = prefixes.flatMap((p) => middles.map((m) => `${p}${m}/evil.com`));

  it.each(inputs)('never starts with // or /\\ (%j)', (raw) => {
    const out = safeCallbackPath(raw);
    expect(out.startsWith('//')).toBe(false);
    expect(out.startsWith('/\\')).toBe(false);
    expect(new URL(out, 'https://home.aspiro.dev').origin).toBe('https://home.aspiro.dev');
  });
});

describe('callbackPathFor', () => {
  it('keeps the path and query, drops the origin', () => {
    expect(callbackPathFor(new URL('https://0.0.0.0:3000/review?month=2026-09'))).toBe(
      '/review?month=2026-09',
    );
  });
});

describe('middleware sign-in redirect', () => {
  beforeEach(() => mockSafeGetToken.mockReset());

  // The container's own view of the request: this origin is what leaked.
  const gated = (path: string) => {
    const url = `https://0.0.0.0:3000${path}`;
    return { url, nextUrl: new URL(url), cookies: { get: () => undefined } } as unknown as NextRequest;
  };

  type Redirect = { status: number; location: string | null };
  const callbackOf = (res: unknown) =>
    new URL((res as Redirect).location!).searchParams.get('callbackUrl');

  it('sends a signed-out visitor to sign in with a relative callbackUrl', async () => {
    mockSafeGetToken.mockResolvedValue(null);

    const res = await middleware(gated('/review?month=2026-09'));

    expect((res as unknown as Redirect).status).toBe(307);
    expect(callbackOf(res)).toBe('/review?month=2026-09');
    // ...and the sign-in page accepts it rather than falling back to /.
    expect(safeCallbackPath(callbackOf(res))).toBe('/review?month=2026-09');
  });

  it('does the same when the refresh token is dead', async () => {
    mockSafeGetToken.mockResolvedValue({ error: 'RefreshAccessTokenError' } as never);

    const res = await middleware(gated('/portfolio'));

    expect(callbackOf(res)).toBe('/portfolio');
  });
});
