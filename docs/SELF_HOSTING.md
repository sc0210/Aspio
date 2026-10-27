# Self-hosting Aspiro

Run your own Aspiro from this repository. Nothing is published for you to pull: you clone
the code and build it on your machine, with Docker (recommended) or without.

The Docker stack is `docker-compose.pi.yml`: Postgres, the backend, the frontend and Caddy,
plus an optional `cloudflared` or `tailscale` container for access from outside your network.
Both dial out, so no inbound port has to be opened.

## Requirements

- 64-bit Linux or macOS (amd64 or arm64). A Raspberry Pi 4/5 works but builds slowly.
- `git` and `openssl`.
- **Docker path:** Docker Engine with the compose plugin, run by a user in the `docker` group.
- **Without Docker:** PostgreSQL 15, Python 3.11, Node 22, and a reverse proxy (Caddy, nginx).
- For access from outside your network, one of:
  - a domain on Cloudflare (free plan), for a Cloudflare Tunnel, or
  - a Tailscale account (free for personal use), for a private `*.ts.net` address.
- Optional: `age` or `gpg` to encrypt backups, the `aws` CLI to upload them to R2/S3.

## 1. Get the code

```bash
git clone https://github.com/sc0210/Aspio.git /opt/aspiro
cd /opt/aspiro
```

Stay on `main` to follow every change, or `git checkout <tag>` to run a fixed version.

## 2. Outside access: Cloudflare Tunnel or Tailscale

Both connect out from your machine, so nothing is opened on your router. They differ in
who can reach the app:

| | Cloudflare Tunnel | Tailscale | Tailscale + Funnel |
|---|---|---|---|
| Who can open it | anyone on the internet | only your own devices, signed in to your tailnet | anyone on the internet |
| Address | your domain, e.g. `aspiro.example.com` | `aspiro.<tailnet>.ts.net` | `aspiro.<tailnet>.ts.net` |
| Needs | a domain on Cloudflare | a Tailscale account; the Tailscale app on each device | the same, plus the `funnel` node attribute |
| LINE bot webhook | works | does not work (LINE's servers are not on your tailnet) | works |
| Google sign-in | works | works | works |

Pick **Tailscale** for a private instance that only you (and devices you add) use. Pick
**Cloudflare Tunnel**, or **Tailscale + Funnel**, when other people or the LINE bot must
reach it. You can run both; `APP_DOMAIN` is then the address people open in a browser.

### 2a. Cloudflare Tunnel

1. Cloudflare → **Zero Trust → Networks → Tunnels**: create a tunnel and copy its token.
2. Add a **public hostname** (e.g. `aspiro.example.com`) pointing at:
   - `http://caddy:80` if `cloudflared` runs in the compose stack (give the token to `aspiro setup`), or
   - `http://localhost:80` if it runs on the host (`sudo cloudflared service install <token>`).
3. Keep **Security → Bots → Bot Fight Mode OFF**: it blocks the LINE webhook and uptime probes.

### 2b. Tailscale

1. Tailscale admin console → **DNS**: turn on **MagicDNS** and **HTTPS Certificates**, and
   note your tailnet name (the `<tailnet>.ts.net` part).
2. **Settings → Keys**: generate an auth key. It is used once, to add the machine; after
   that the node's identity lives in the `tailscale_state` volume.
3. Only for Funnel: in **Access controls**, give the node the `funnel` attribute
   (`"nodeAttrs": [{"target": ["autogroup:member"], "attr": ["funnel"]}]`, or a narrower target).
4. Give the key to `aspiro setup` (below) with the hostname `aspiro.<tailnet>.ts.net`; add
   `--funnel` to make it public. The node is named after the hostname's first label.

The `tailscale` container serves `https://aspiro.<tailnet>.ts.net` with a certificate it
obtains itself and forwards to Caddy (`tailscale/serve.json`, or `tailscale/funnel.json`
with Funnel). Open it from any device signed in to your tailnet.

## 3. Google sign-in

Google Cloud Console → **APIs & Services → Credentials** → OAuth client, type *Web
application*. Use the address people open: your Cloudflare hostname, or the `*.ts.net`
one with Tailscale. Google rejects a LAN IP as a redirect URI, but accepts a `ts.net` name
even when only your tailnet can reach it.

- Authorized JavaScript origin: `https://aspiro.example.com`
- Authorized redirect URI: `https://aspiro.example.com/api/auth/callback/google`

## 4. Run it with Docker

```bash
scripts/aspiro setup             # writes .env (mode 600) and generates the secrets
scripts/aspiro update --init     # first install only: builds, initialises the database, starts
scripts/aspiro status
```

`setup` asks for the hostname, the Google client ID and secret, the Cloudflare tunnel token
and the Tailscale auth key (skip whichever you don't use), and prints the redirect URI to
register. It never overwrites `.env` unless you pass `--force`,
which keeps every existing value unless you give a new one; `--force --rotate-secrets` also
regenerates `SECRET_KEY` and `NEXTAUTH_SECRET` (everyone is signed out). For a script, pass
`--non-interactive --domain … --google-client-id … --google-client-secret …` plus
`--tunnel-token …` or `--tailscale-authkey … [--funnel]`. `--force --funnel` / `--no-funnel`
switches an existing Tailscale install between public and tailnet-only.
LINE and SMTP settings are documented in `production.env.sample`. The LINE bot is optional:
with `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` blank the app runs without it and
hides LINE linking and group splitting. Set both and restart the backend to turn it on.

Pass `--init` on the first install only. It is the only mode allowed to build the schema in
an empty database, so a lost volume or a wrong `DATABASE_URL` later fails loudly instead of
coming up as a fresh, empty app.

The first build compiles Caddy from source and the frontend from scratch: a few minutes on
x86, much longer on a Pi. Then `https://aspiro.example.com/` should load and
`https://aspiro.example.com/api/v1/users/me` should answer `401`.

### Make yourself admin

New accounts wait for an admin to approve them, so the first admin is made from the
command line. Register at `https://aspiro.example.com/` with your own email, then:

```bash
scripts/aspiro admin grant you@example.com              # super_admin by default
scripts/aspiro admin grant helper@example.com support   # roles: super_admin, admin, moderator, analyst, support
scripts/aspiro admin list
```

`grant` approves the account if it is still pending and gives it the role; sign out and back
in to see `/admin`. From then on, approve users and manage other admins on the admin page.
Do it after your own registration succeeded: that proves nobody else registered your email.

`ADMIN_EMAILS=you@example.com:super_admin` in `.env` does the same at every backend start.
Use it only on a private (tailnet-only) instance: on a public one, whoever registers a listed
email first becomes admin at the next restart.

### Updates

```bash
scripts/aspiro update                 # pull the branch you are on, rebuild, restart
scripts/aspiro update --ref v1.2.0    # a specific tag, branch or commit (also a rollback)
```

`update` refuses a checkout with local changes. Then it:

1. fetches and fast-forwards the branch (or checks out `--ref`);
2. tags the running images `aspiro-<svc>:previous`;
3. builds `backend` and `frontend` here;
4. runs the migrations (`--init` only when you pass it);
5. restarts the stack and waits until `/health` is healthy and the schema is at head.

If the build, the migration or the health check fails, it puts back both the previous images
and the previous checkout. What it ran is recorded in `.aspiro-state/`.

To update on a schedule, run `scripts/aspiro backup && scripts/aspiro update` from a systemd
timer or cron as a user in the `docker` group.

## 4b. Run it without Docker

Mirror what the images do. Create a Postgres database and user, then:

```bash
# Backend (from backend/)
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export ENVIRONMENT=production SKIP_DB_SCHEMA_INIT=true \
  DATABASE_URL=postgresql+asyncpg://aspiro:<password>@127.0.0.1:5432/aspiro \
  SECRET_KEY=$(openssl rand -hex 32) \
  CORS_ORIGINS='["https://aspiro.example.com"]' FRONTEND_URL=https://aspiro.example.com \
  GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… TRUSTED_PROXY_COUNT=1
bash scripts/migrate.sh --init          # first install only; later runs without --init
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers

# Frontend (from frontend/)
npm ci
NEXT_PUBLIC_API_URL= npm run build      # empty = call the API on the same origin
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
INTERNAL_API_URL=http://127.0.0.1:8000/api/v1 NEXTAUTH_URL=https://aspiro.example.com \
  NEXTAUTH_SECRET=$(openssl rand -base64 32) GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… \
  PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

Keep the secrets in an environment file rather than your shell history, and run both
processes under systemd. Point the reverse proxy at them the way `caddy/Caddyfile` does:
`/api/v1/*` → `127.0.0.1:8000`, everything else → `127.0.0.1:3000`. To update: `git pull`,
`pip install -r requirements.txt`, `bash scripts/migrate.sh`, rebuild the frontend, restart
both.

## Backups

```bash
scripts/aspiro backup --keep 14
```

Each run writes `backups/db/aspiro_<stamp>.sql.gz` (a `pg_dump`) and
`aspiro_<stamp>.uploads.tar.gz` (receipt attachments; the database only points at them, so
a restore needs both), and keeps the newest N of each.

| Variable | Effect |
|---|---|
| `ASPIRO_BACKUP_DIR` | Where backups go (default `backups/db`) |
| `ASPIRO_BACKUP_AGE_RECIPIENT` / `ASPIRO_BACKUP_GPG_RECIPIENT` | Encrypt both files; on failure nothing is uploaded and the plaintext is kept at mode 600 |
| `ASPIRO_BACKUP_S3_URI` | Upload to S3-compatible storage, e.g. `s3://my-bucket/aspiro` |
| `ASPIRO_BACKUP_S3_ENDPOINT` | For Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials for the upload |

Restore (decrypt first if needed):

```bash
gunzip -c backups/db/aspiro_<stamp>.sql.gz \
  | docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -v ON_ERROR_STOP=1
docker exec -i aspiro-backend tar -C /app/uploads -xzf - < backups/db/aspiro_<stamp>.uploads.tar.gz
```

Test a restore once, before you need it.

### Moving the dev stack's data to a new host

`scripts/export_for_migration.sh` stops the dev backend and frontend, writes a dump, the
uploads archive, a per-table row-count file and checksums to `backups/migrate/`, then
starts them again. Copy the four files over, then on the new host, in this order:

1. `shasum -a 256 -c aspiro_<stamp>.sha256`
2. `scripts/aspiro setup`, then start only the database:
   `docker compose --env-file .env -f docker-compose.pi.yml up -d postgres`
3. Restore the SQL with the `gunzip … | psql` command above. If it stops on an error, or
   `--check` fails, start over on an empty database. This deletes that database, so do it
   only on the **new host**, only before step 5, and only once step 1 has passed:

   ```bash
   vol=$(docker inspect aspiro-postgres --format '{{range .Mounts}}{{.Name}}{{end}}')
   echo "$vol"    # the database's own volume, read off the container
   docker compose --env-file .env -f docker-compose.pi.yml rm -sf postgres
   docker volume rm "$vol"
   ```

   Then go back to step 2.
4. `scripts/export_for_migration.sh --check aspiro_<stamp>.counts`. Run it now, while
   nothing else touches the database, so the comparison is exact.
5. `scripts/aspiro update`, **without `--init`**: it migrates the restored database to
   head and starts the stack.
6. Restore the uploads with the `docker exec -i aspiro-backend tar …` command above. It
   needs the backend running, which is why it comes last.

## Rollback

`scripts/aspiro update --ref <earlier tag or commit>`. Migrations are **not** reversed: an
older backend usually tolerates a newer schema, but not always, so back up before every
update and restore that backup when rolling back across a schema change.

## Security checklist

- [ ] `.env` is mode 600, in no repository, and its secrets came from `aspiro setup`. The
      backend refuses placeholder secrets unless `ALLOW_INSECURE_DEFAULTS=true`; never set
      that on a reachable host.
- [ ] If a secret leaks: `aspiro setup --force --rotate-secrets`; rotate the tunnel token in
      Cloudflare, or remove the machine in the Tailscale admin console and set a new auth key;
      changing `POSTGRES_PASSWORD` also needs an `ALTER USER` in Postgres.
- [ ] Postgres listens on loopback only, and no router port is forwarded.
- [ ] `aspiro admin list` shows only the admins you expect, and a public instance leaves
      `ADMIN_EMAILS` unset.
- [ ] Public instances (Cloudflare, or Tailscale with Funnel): put **Cloudflare Access** in
      front of `/admin*` and `/api/v1/admin*`. Funnel has no equivalent, so a public Funnel
      instance relies on the app's own admin checks. A tailnet-only instance is private already.
- [ ] Leave `ENABLE_API_DOCS` off (the default), or put `/docs` and `/openapi.json` behind Access.
- [ ] Backups are encrypted and stored off the host.
