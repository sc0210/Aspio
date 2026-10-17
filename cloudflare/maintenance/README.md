# Maintenance page (Cloudflare Worker)

When the origin is unreachable (the tunnel is down, the host is off or rebooting, or a deploy is restarting Caddy), Cloudflare normally shows its bare **530 / error 1033** page. This Worker sits on the route and passes every request through untouched. Only when the origin is down **and** the request is a browser page load does it serve a small "back soon" page instead. The page is bilingual, returns `503` with `Retry-After`, and refreshes itself every minute.

Everything else keeps the origin's real status, so monitoring and the app still see the outage:

- `/api/*`, which covers the backend, the NextAuth routes and the LINE webhook
- `/_next/*` static assets
- any non-GET/HEAD request
- anything that is not a navigation and does not accept `text/html`

App errors (`4xx`, `500`) are the app answering, so they pass through. Only `502–504`, `520–527` and `530` count as "down". That includes a `503` the app sends on purpose: on a page load its body is replaced by this page, and the status stays `503`.

## Cost

The Workers free tier allows 100k requests/day, and every request to the hostname counts, not only failures. A personal install is far below that. If you are over it, Cloudflare's default is to fail open for the route, so the site is served as if the Worker were not there.

## Deploy

`wrangler` needs Node 22+.

```bash
cd cloudflare/maintenance
npm test                     # 8 cases, no dependencies
npx wrangler@4 login         # once
npx wrangler@4 deploy        # attaches to the route in wrangler.toml
```

Self-hosters: change the `routes` pattern and `zone_name` in `wrangler.toml` to your hostname first.

You can also do it without wrangler: in the Cloudflare dashboard go to Workers & Pages, create a Worker, paste `worker.js`, deploy it, then add a route under Settings → Domains & Routes.

## Check it

While the origin is down, `curl -sI -H 'Accept: text/html' https://<host>/` should show `HTTP/2 503` and `x-aspiro-maintenance: 530`. The `Accept` header matters: plain curl sends `*/*`, which is not a page load, so without it you get the real `530` (that is how the uptime probe keeps seeing the outage). `curl -s -o /dev/null -w '%{http_code}' https://<host>/api/v1/users/me` should still print `530`.

## Remove it

Delete the route (or the Worker) in the dashboard, or run `npx wrangler@4 delete`. Nothing on the origin depends on it.
