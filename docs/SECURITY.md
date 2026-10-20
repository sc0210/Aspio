# Security

What is actually enforced, and the rules that exist because something went wrong once.

## The rule that matters most

**Never gate anything security-relevant on `ENVIRONMENT`, `DEBUG`, or `is_development`.**

A self-hosted instance can be internet-facing and still report `ENVIRONMENT=development`. `DEBUG`
is true on every stack built from the base compose file, including internet-reachable ones. Any
check of the form "if we're in dev, open this up" is therefore open in production.

Dangerous surfaces use an explicit opt-in secret instead:

| Setting | Default | Guards |
|---|---|---|
| `DEV_TOOLS_TOKEN` | `""` (closed) | All developer routes. Presented as `X-Dev-Tools-Token`. Empty value ⇒ every dev route stays shut |
| `DEV_LOGIN_ENABLED` | `false` | Password-less `/auth/dev-login`. The flag alone is not sufficient — see `dev_login_active` |
| `ENABLE_API_DOCS` | `false` | `/docs`, `/redoc`, `/openapi.json`. A published schema is a map of every route and payload shape, so it is opt-in |

`/dev/db-sync/*` truncates and replaces whole databases and has no user auth. It requires the
full `dev_tools_active` gate (explicit token *and* a local DB), not merely a development
environment.

## Authentication

- JWT, `HS256`, access token 30 min (`ACCESS_TOKEN_EXPIRE_MINUTES`), refresh token 7 days
  (`REFRESH_TOKEN_EXPIRE_DAYS`).
- Google OAuth 2.0 for social sign-in; `GoogleOAuthManager` in `users/security.py`.
  `POST /auth/google/callback` is called by NextAuth's server, but nothing stops anyone else
  from calling it, so its body is only a claim: `verify_token_identity` asks Google's tokeninfo
  who the token belongs to (this app's client ID, verified email, matching `sub` and email)
  before any account is looked up. Caddy also refuses the path from outside; NextAuth reaches
  it over the Docker network. Never issue tokens from a body field the caller supplied.
- `SECRET_KEY` signs tokens — generate with `openssl rand -hex 32`, never commit one.
- Frontend sessions are NextAuth JWTs holding the backend's access/refresh pair. On refresh
  failure the client redirects to `/api/auth/destroy`, which clears cookies server-side;
  `signOut()` races the HttpOnly cookies and leaves a half-logged-out state.
- `CurrentUser` (`users/dependencies.py`) is the only sanctioned way to resolve the caller.

The LINE webhook is the one unauthenticated endpoint. It is verified by HMAC over the request
body against `X-Line-Signature`, not by JWT — do not "fix" it by adding auth, and do not skip
the signature check.

## Transport and headers

Set in `app/middleware/pure_asgi.py` on every response:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: …
```

CORS is an explicit allowlist: `CORS_ORIGINS` in config, extendable per-deployment via
`EXTRA_CORS_ORIGINS` (comma-separated) without touching source. Add the exact origin — never
widen to `*`.

## Rate limiting

`app/middleware/rate_limit.py` — an **in-memory sliding window**, per client. There is no Redis
involved despite what older notes may claim.

- `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST` control the defaults.
- Per-path rules are strict on auth endpoints and loose on core SPA endpoints.
- `RATE_LIMIT_DEV_MULTIPLIER` loosens auth limits for React strict mode's double-invoked
  effects. It is a separate knob precisely so production cannot inherit a 10× looser login
  limit from an env shape.
- Exceeding a limit returns `RATE_LIMIT_EXCEEDED`.

Because state is in-process, limits are per-worker. Treat it as abuse-dampening, not as a hard
quota.

## Data access

- **SQL injection**: all queries go through SQLAlchemy with bound parameters. Never build SQL by
  string concatenation, including in `backend/scripts/`.
- **Multi-tenancy**: every user-scoped query filters on `user_id`. A repository method that
  takes an id but not a user id is a bug waiting to happen.
- **RLS**: every new public table needs row-level security enabled in the same change. The
  backend connects as superuser and bypasses RLS, so a missing policy is invisible from the app
  and only shows up when something else reads the table.

## Secrets

- `.env*` files are gitignored and must stay that way. Real secrets live in the deployment's own
  secret store.
- `.env.sample` / `backend/.env.sample` carry placeholder values only.
- Rotate `SECRET_KEY` and `NEXTAUTH_SECRET` independently per deployment target — local and
  each self-hosted instance must not share a signing key.
- A committed secret stays in history, which a public repo serves. Rotate it; deleting the file
  is not enough. `gitleaks git --redact .` scans every commit.

## Public repository and CI

A fork's pull request runs its own copy of the workflow files.

- **No self-hosted runners**: a fork could point `runs-on` at one and run code on it. CI deploys
  nothing; operators pull the repo and build it themselves.
- Never check out PR head code in a `pull_request_target` or `workflow_run` job: those run with
  the base repo's token.
- Outside contributors' workflows need approval; `main` takes PRs only, with CI passing.

## Reviewing a change

Before merging anything that touches auth, a router's dependencies, middleware, or a raw query:

1. Does any new gate key off `ENVIRONMENT`/`DEBUG`? Replace it with an explicit token check.
2. Does every new query filter by `user_id`?
3. Does a new table have RLS?
4. Does a new endpoint declare `CurrentUser`, or is it deliberately public and documented as such?
5. Are new env vars in `.env.sample` with placeholder values?
