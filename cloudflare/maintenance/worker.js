// Maintenance page for a self-hosted Aspiro behind a Cloudflare Tunnel.
//
// Every request passes straight through to the origin. Only when the origin is down
// (the tunnel is disconnected, or Caddy/the app is not answering) AND the request is
// a browser page load does the visitor get a "back soon" page instead of
// Cloudflare's bare 530 / error 1033.
//
// Everything else keeps the origin's real status: API calls, the LINE webhook, the
// GitHub uptime probe and static assets. Monitoring must still see the outage, and a
// fetch() in the app must still fail like a fetch, not parse HTML.

// Statuses that mean "the origin did not answer", not "the app answered with an error".
// 520-527 and 530 are Cloudflare's own (530 + error 1033 = tunnel down).
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

const RETRY_AFTER_SECONDS = 60;

export function isOriginDown(status) {
  return ORIGIN_DOWN.has(status);
}

export function isPageLoad(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/') || path.startsWith('/_next/')) return false;
  if (request.headers.get('sec-fetch-mode') === 'navigate') return true;
  return (request.headers.get('accept') || '').includes('text/html');
}

export function maintenanceResponse(request, originStatus) {
  const body = request.method === 'HEAD' ? null : PAGE.replace('{{STATUS}}', String(originStatus));
  return new Response(body, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(RETRY_AFTER_SECONDS),
      'x-aspiro-maintenance': String(originStatus),
    },
  });
}

export default {
  async fetch(request) {
    let response;
    try {
      response = await fetch(request);
    } catch {
      // The subrequest itself failed: the origin is unreachable. Answer with a plain
      // 502 rather than rethrowing, which would surface as a Worker exception (1101).
      if (isPageLoad(request)) return maintenanceResponse(request, 0);
      return new Response('origin unreachable', { status: 502 });
    }
    if (isOriginDown(response.status) && isPageLoad(request)) {
      return maintenanceResponse(request, response.status);
    }
    return response;
  },
};

// Self-contained: the origin is down, so nothing here may load from it.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${RETRY_AFTER_SECONDS}">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>Aspiro · Back soon</title>
<style>
  :root { --bg: #f8fafc; --card: #ffffff; --text: #0f172a; --muted: #64748b; --brand: #059669; --on-brand: #ffffff; --ring: #d1fae5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b1120; --card: #111827; --text: #e5e7eb; --muted: #94a3b8; --brand: #34d399; --on-brand: #022c22; --ring: #064e3b; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         background: var(--bg); color: var(--text);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", "PingFang TC", "Noto Sans TC", sans-serif; }
  main { width: 100%; max-width: 440px; background: var(--card); border-radius: 16px; padding: 32px 28px;
         box-shadow: 0 0 0 1px var(--ring), 0 10px 30px rgba(0,0,0,.06); text-align: center; }
  .mark { width: 48px; height: 48px; margin: 0 auto 16px; border-radius: 12px; background: var(--brand);
          color: var(--on-brand); display: grid; place-items: center; font-weight: 700; font-size: 22px; }
  h1 { font-size: 1.35rem; margin: 0 0 8px; }
  p { margin: 0 0 6px; color: var(--muted); }
  .zh { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--ring); }
  .zh h1 { font-size: 1.15rem; }
  .meta { margin-top: 20px; font-size: .8rem; color: var(--muted); }
  button { margin-top: 18px; border: 0; border-radius: 10px; padding: 10px 18px; font: inherit; font-weight: 600;
           background: var(--brand); color: var(--on-brand); cursor: pointer; }
  button:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">A</div>
  <h1>Aspiro is down for maintenance</h1>
  <p>Your data is safe. We'll be back shortly, and this page refreshes itself every minute.</p>
  <div class="zh" lang="zh-Hant">
    <h1>Aspiro 維護中</h1>
    <p>您的資料安全無虞。服務將很快恢復，本頁每分鐘會自動重新整理。</p>
  </div>
  <button type="button" onclick="location.reload()">Try again · 重新整理</button>
  <div class="meta">origin status {{STATUS}}</div>
</main>
</body>
</html>
`;
