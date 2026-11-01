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
- **Without Docker:** PostgreSQL 15, Python 3.14, Node 22, and a reverse proxy (Caddy, nginx).
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

Caddy publishes ports 80 and 443 on every interface unless `CADDY_BIND` says otherwise, which
the LAN-HTTPS setup (the custom Caddy build serving your network directly) needs. A Cloudflare
Tunnel or Tailscale host needs only loopback: keep `CADDY_BIND=127.0.0.1` from
`production.env.sample`, so the plain-HTTP origin is not reachable from the LAN. `aspiro update`
warns when the `tunnel` or `tailscale` profile is on and `CADDY_BIND` is unset.

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
4. dumps the database to `backups/pre-update/` (not with `--init`), starting `postgres` first
   if it is down, and records the dump's path in `.aspiro-state/backup`. This dump is the
   database only, stays on this machine, and keeps the newest 3, apart from `aspiro backup`'s
   own rotation;
5. runs the migrations (`--init` only when you pass it);
6. restarts the stack and waits until `/health` is healthy and the schema is at head;
7. prunes this project's dangling images and trims the build cache to 3 GB.

If the backup, the build, the migration or the health check fails, it puts back both the
previous images and the previous checkout. Migrations are not reversed, so a failure after
step 5 also prints the exact commands that restore the step 4 dump. What it ran is recorded
in `.aspiro-state/`.

To update on a schedule, run `scripts/aspiro update` from a systemd timer or cron as a user
in the `docker` group. The pre-update dump is not a backup schedule: keep running
`aspiro backup` for that, and for the receipt attachments and offsite copy it alone makes.

### Analytics (optional)

Aspiro can count page views and page-load speed with Cloudflare Web Analytics: free, no
cookies, no fingerprinting. It is off until you set a token. Even then, each visitor has to
accept it in the consent banner, and can turn it off later in Settings → Privacy & Display.
Browsers with Do Not Track on send nothing, and amounts or account details are never sent.

1. In the Cloudflare dashboard, open **Analytics & Logs → Web Analytics → Add a site**, enter
   your hostname and choose the manual **JS snippet**. Leave automatic setup off: it makes
   Cloudflare inject the beacon at its edge for every visitor, before anyone has agreed.
2. Copy the `token` value from the snippet (`data-cf-beacon='{"token": "…"}'`).
3. Add it to `.env`: `NEXT_PUBLIC_CF_ANALYTICS_TOKEN=<token>`
4. Run `scripts/aspiro update`. The token is built into the frontend image, so a restart alone
   does not pick it up.

Clear the variable and update again to switch analytics off; the banner disappears with it.

## 4b. Run it without Docker

Mirror what the images do. Create a Postgres database and user, then:

```bash
# Backend (from backend/)
python3.14 -m venv .venv && . .venv/bin/activate
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
a restore needs both), and keeps the newest N of each. Both are mode 600 in a mode 700
directory.

| Variable | Effect |
|---|---|
| `ASPIRO_BACKUP_DIR` | Where backups go (default `backups/db`) |
| `ASPIRO_BACKUP_AGE_RECIPIENT` / `ASPIRO_BACKUP_GPG_RECIPIENT` | Encrypt both files; on failure nothing is uploaded and the plaintext is kept at mode 600 |
| `ASPIRO_BACKUP_S3_URI` | Upload to S3-compatible storage, e.g. `s3://my-bucket/aspiro`. Refused unless a recipient above is set |
| `ASPIRO_BACKUP_S3_ENDPOINT` | For Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials for the upload |

`scripts/backup_db.sh` is the cron-able dump for a dev or Pi stack that is not managed by
`aspiro`. It writes the same `backups/db/aspiro_<stamp>.sql.gz` (the database only, kept
`KEEP_DAYS`), and sends an offsite copy (`RCLONE_REMOTE` or `BACKUP_SCP_DEST`) only when
`BACKUP_AGE_RECIPIENT` is set, as `<dump>.age`. Plaintext dumps uploaded before encryption
was required stay in the bucket or on the remote host until you delete them.

Restore by reading the dump twice: once to check it is intact (`gzip -t`) and ends with
pg_dump's closing marker as a line of its own, then into `psql` in one transaction with
`ON_ERROR_STOP`. The check matters because a pipe reports only `psql`'s status: a dump cut
off part-way, or one whose decryption or decompression stops early, would otherwise still
run and commit what it got. The marker is matched as a whole line near the end, because a
row of data can hold the same words. The `DROP SCHEMA` line empties the existing database in
the same transaction, so a failure changes nothing; it is harmless on an empty one.

On a running stack, stop the apps first (`docker stop aspiro-backend aspiro-frontend`) and
start them again (`docker start aspiro-backend aspiro-frontend`) once the restore succeeded.
If the check refuses the dump, the database is as it was, so starting them again is safe.

```bash
# On a running stack: docker stop aspiro-backend aspiro-frontend first (see above).
dump=backups/db/aspiro_<stamp>.sql.gz
read_dump() { gzip -t "$dump" && gunzip -c "$dump"; }
read_dump | tail -n 5 | grep -qx -- '-- PostgreSQL database dump complete' \
  && { echo 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'; read_dump; } \
  | docker exec -i aspiro-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction -v ON_ERROR_STOP=1' \
  || echo 'Restore NOT applied: the dump is incomplete or psql failed. The database is unchanged.' >&2
```

Only after that restore succeeded and the backend is running again, restore the uploads
archive if the backup has one (`aspiro backup` writes one; the pre-update dump does not):

```bash
gzip -t backups/db/aspiro_<stamp>.uploads.tar.gz \
  && docker exec -i aspiro-backend tar -C /app/uploads -xzf - < backups/db/aspiro_<stamp>.uploads.tar.gz
```

If the first line of the pipe fails, nothing ran: the dump is incomplete. An encrypted copy
(from `aspiro backup` with a recipient, or `backup_db.sh`'s offsite `.age`) restores the same
way with `read_dump` decrypting in the pipe (age and gpg reject a damaged file themselves):

```bash
read_dump() { age -d -i <your age identity file> "$dump" | gunzip -c; }   # .age
read_dump() { gpg -d "$dump" | gunzip -c; }                               # .gpg
```

`read_dump` runs twice, so a passphrase-protected key asks twice.

Test a restore once, before you need it.

### Moving the dev stack's data to a new host

`scripts/export_for_migration.sh` stops the dev backend and frontend, writes a dump, the
uploads archive, a per-table row-count file and checksums to `backups/migrate/`, then
starts them again. Copy the four files over, then on the new host, in this order:

1. `shasum -a 256 -c aspiro_<stamp>.sha256`
2. `scripts/aspiro setup`, then start only the database:
   `docker compose --env-file .env -f docker-compose.pi.yml up -d postgres`
3. Restore the SQL with the `read_dump … | psql` restore command above. If it stops on an error, or
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
older backend usually tolerates a newer schema, but not always. Every update backs up first
(`.aspiro-state/backup` names the dump), so restore that dump, over the existing database
as shown under Backups, when rolling back across a schema change. The rollback update takes
its own dump of the migrated database, so right after it `.aspiro-state/backup.prev` names the
one taken before the bad update: restore that one before running any other update, which
rotates the pointer again (the file itself stays in `backups/pre-update/`, newest three kept).

Caddy caps request bodies at 11 MiB, the backend's `MAX_FILE_SIZE_MB` (10) plus 1 MiB. Raise
`max_size` in both `caddy/Caddyfile` and `caddy/Caddyfile.http` if you raise `MAX_FILE_SIZE_MB`.

## Security checklist

- [ ] `.env` is mode 600, in no repository, and its secrets came from `aspiro setup`. The
      backend refuses placeholder secrets unless `ALLOW_INSECURE_DEFAULTS=true`; never set
      that on a reachable host.
- [ ] If a secret leaks: `aspiro setup --force --rotate-secrets`; rotate the tunnel token in
      Cloudflare, or remove the machine in the Tailscale admin console and set a new auth key;
      changing `POSTGRES_PASSWORD` also needs an `ALTER USER` in Postgres.
- [ ] Postgres listens on loopback only, Caddy too on a tunnel or Tailscale host
      (`CADDY_BIND=127.0.0.1`), and no router port is forwarded.
- [ ] `aspiro admin list` shows only the admins you expect, and a public instance leaves
      `ADMIN_EMAILS` unset.
- [ ] Public instances (Cloudflare, or Tailscale with Funnel): put **Cloudflare Access** in
      front of `/admin*` and `/api/v1/admin*`. Funnel has no equivalent, so a public Funnel
      instance relies on the app's own admin checks. A tailnet-only instance is private already.
- [ ] Leave `ENABLE_API_DOCS` off (the default), or put `/docs` and `/openapi.json` behind Access.
- [ ] Backups are encrypted and stored off the host.
