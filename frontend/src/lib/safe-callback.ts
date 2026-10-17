const PROBE_ORIGIN = 'http://callback.invalid';

/**
 * Where to send someone after they sign in.
 *
 * Only a same-site path is accepted. `startsWith('/')` alone is not enough:
 * `//evil.com` and `/\evil.com` both start with a slash, and a browser reads
 * either as a protocol-relative URL to another host (it normalises `\` to `/`).
 * Nor is checking the second character: the URL parser strips tab, CR and LF
 * anywhere, so `/\t/evil.com` becomes `//evil.com` too. The credentials sign-in
 * hands this value to `router.push`, so any of them would make the sign-in page
 * an open redirect.
 *
 * So parse it the way the browser will, and return the parsed form. Then check
 * that form too: normalising dot segments can itself produce a leading `//`
 * (`/.//evil.com`, `/%2e//evil.com` and `/a/..//evil.com` all parse to the
 * pathname `//evil.com` while still matching the probe origin), and the browser
 * re-reads the result against the real origin.
 */
export function safeCallbackPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return '/';
  try {
    const url = new URL(raw, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return '/';
    const path = url.pathname + url.search + url.hash;
    return path.startsWith('//') ? '/' : path;
  } catch {
    return '/';
  }
}

/**
 * The callbackUrl the middleware attaches when it bounces someone to sign in.
 *
 * Relative on purpose. `request.url` is what the Next server sees, and behind
 * Caddy/the tunnel that is `https://0.0.0.0:3000/...` — an absolute URL the
 * sign-in page rightly refuses, so every deep link used to land on `/` instead.
 */
export function callbackPathFor(url: { pathname: string; search: string }): string {
  return url.pathname + url.search;
}
