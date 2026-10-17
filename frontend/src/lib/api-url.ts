/**
 * The one place that decides where the FastAPI backend lives.
 *
 * Production serves the app and `/api/*` from ONE origin (Caddy on the host,
 * reached through the Cloudflare Tunnel), so the browser needs no hostname at
 * all: a relative `/api/v1` works on whatever domain the image is deployed
 * behind. That is what lets a single prebuilt frontend image run anywhere —
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at `next build`, so
 * any absolute URL baked in there pins the image to one domain.
 *
 * Resolution rules:
 *
 * Browser (`getPublicApiUrl`)
 *   1. `NEXT_PUBLIC_API_URL`, when set and non-empty — an opt-in override for
 *      split deployments (frontend and API on different origins) and for local
 *      dev, where the app is on :3000 and the API on :8000.
 *   2. `next dev` with nothing set → `http://localhost:8000/api/v1`, so a bare
 *      native dev server keeps talking to the local backend.
 *   3. Otherwise the same-origin path `/api/v1`.
 *
 * Server (`getServerApiUrl`) — always ABSOLUTE, because Node's fetch cannot
 * resolve a relative URL:
 *   1. `INTERNAL_API_URL` (container-to-container, e.g. http://backend:8000/api/v1).
 *   2. `NEXT_PUBLIC_API_URL`, only if it is absolute.
 *   3. `http://localhost:8000/api/v1`.
 */

export const SAME_ORIGIN_API_PATH = '/api/v1';
export const LOCAL_DEV_API_URL = 'http://localhost:8000/api/v1';

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

export function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Base URL for API calls made from the browser. May be relative. */
export function getPublicApiUrl(): string {
  // Must stay a literal `process.env.NEXT_PUBLIC_API_URL` access so Next.js can
  // inline it into the client bundle.
  const override = clean(process.env.NEXT_PUBLIC_API_URL);
  if (override) return override;
  if (process.env.NODE_ENV === 'development') return LOCAL_DEV_API_URL;
  return SAME_ORIGIN_API_PATH;
}

/** Base URL for API calls made from the Next.js server. Always absolute. */
export function getServerApiUrl(): string {
  const internal = clean(process.env.INTERNAL_API_URL);
  if (internal) return internal;
  const publicUrl = clean(process.env.NEXT_PUBLIC_API_URL);
  if (publicUrl && isAbsoluteUrl(publicUrl)) return publicUrl;
  return LOCAL_DEV_API_URL;
}

/**
 * The backend's root (no `/api/v1`), for endpoints mounted outside the
 * versioned API such as `/health`. Server-side only.
 */
export function getServerBackendOrigin(): string {
  return getServerApiUrl().replace(/\/api\/v\d+$/, '');
}
