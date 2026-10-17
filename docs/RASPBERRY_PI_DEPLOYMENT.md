# Aspiro — Raspberry Pi / LAN Self-Host Deployment

Run a **complete, self-contained Aspiro instance on a Raspberry Pi** (or any always-on
Linux box). It runs its **own** frontend, backend, and PostgreSQL in Docker, and it is
**all of production**.

Reachable from the home WiFi directly, and from anywhere through a Cloudflare Tunnel
(§ Public access) — which dials out from the Pi, so no router port is ever opened.

Two access modes:

| Mode | Compose overlay | URL | Login | Needs |
|------|-----------------|-----|-------|-------|
| **A. IP only** | `docker-compose.lan.yml` | `http://<pi-ip>:3000` | email/password, demo | nothing extra |
| **B. Domain + HTTPS** | `docker-compose.caddy.yml` | `https://home.aspiro.dev` | **+ Google OAuth** | a domain on Cloudflare |

> Google OAuth **rejects raw private IPs**, so Google login only works in Mode B (real
> domain + HTTPS). Mode A is fine with email/password or demo mode.

---

## Prerequisites

- Raspberry Pi 4 or newer, **64-bit OS** (Raspberry Pi OS Lite arm64, or Ubuntu Server arm64). 4GB+ RAM (8GB ideal).
- Docker + Docker Compose v2:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # log out/in afterwards
  ```
- Passwordless SSH from your dev machine: `ssh-copy-id -i ~/.ssh/id_ed25519.pub <user>@<pi-ip>`

---

## 1. Copy the source to the Pi

The Pi runs the same code as your dev machine. Push it with `rsync`, excluding
arch-specific / generated dirs (they are rebuilt for arm64 inside the containers):

```bash
rsync -az \
  --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='.venv' --exclude='__pycache__' --exclude='.playwright-mcp' \
  ./ <user>@<pi-ip>:/home/<user>/Aspiro/
```

This includes `.env` (Docker Compose needs it for variable substitution). Re-run the same
command to push code updates later.

---

## 2A. Mode A — IP only (http)

```bash
ssh <user>@<pi-ip>
cd ~/Aspiro
LAN_HOST=<pi-ip> docker compose \
  -f docker-compose.yml -f docker-compose.lan.yml \
  up -d --build postgres backend frontend pgadmin
```

Browse to `http://<pi-ip>:3000`. Only these 4 services start — **`quickchart` is skipped
(no arm64 image)** and `cloudflared` isn't needed on a LAN. `docker-compose.lan.yml` only
overrides the browser-facing URLs (`NEXT_PUBLIC_API_URL`, `NEXTAUTH_URL`, `CORS_ORIGINS`,
`FRONTEND_URL`) to the Pi's IP; `INTERNAL_API_URL` stays container-internal.

---

## 2B. Mode B — Domain + HTTPS (enables Google login)

Requires a domain whose DNS **you** control. Example below uses `aspiro.dev` on
**Cloudflare** and the hostname `home.aspiro.dev`.

### i. DNS record
Cloudflare → your domain → **DNS** → add an **A** record:
- Name `home`  (→ `home.aspiro.dev`)
- IPv4 `<pi-ip>`
- **Proxy status: DNS only (grey cloud ☁️)** — required. Orange-cloud proxying can't reach a private IP.

Public DNS pointing at a private IP is fine: only devices on your LAN can reach it, but
every device auto-resolves the name. (The same domain can serve Vercel prod on a *different*
subdomain — one hostname = one destination, but subdomains are unlimited.)

### ii. Cloudflare API token (for automatic HTTPS)
Cloudflare → **My Profile → API Tokens → Create Token** → **Edit zone DNS** template →
Zone Resources: your zone → Create. Copy the token. This lets Caddy solve the Let's Encrypt
**DNS-01** challenge (issues a real cert by writing a TXT record — works even though the Pi
isn't reachable from the public internet). Use this **scoped** token, never the Global API Key.

### iii. Secret file on the Pi (never committed)
```bash
umask 077
cat > ~/Aspiro/caddy/cf.vars <<'EOF'
APP_DOMAIN=home.aspiro.dev
CF_API_TOKEN=<your-cloudflare-zone-dns-edit-token>
EOF
chmod 600 ~/Aspiro/caddy/cf.vars
```

### iv. Google OAuth redirect URI
Google Cloud Console → **Credentials** → your OAuth 2.0 client:
- Authorized JavaScript origin: `https://home.aspiro.dev`
- Authorized redirect URI: `https://home.aspiro.dev/api/auth/callback/google`

(Adds alongside your existing localhost / Vercel URIs — same client, nothing breaks.)

### v. Start
```bash
cd ~/Aspiro
docker compose --env-file .env --env-file caddy/cf.vars \
  -f docker-compose.yml -f docker-compose.caddy.yml \
  up -d --build postgres backend frontend pgadmin caddy
```

Caddy auto-obtains the certificate on first start (watch `docker logs aspiro-caddy` for
`certificate obtained successfully`). Then browse to `https://home.aspiro.dev`.

**What the `caddy/` dir contains:**
- `Dockerfile` — builds Caddy with the `caddy-dns/cloudflare` plugin (arm64).
- `Caddyfile` — one HTTPS entrypoint: `/api/v1/*` → `backend:8000`, everything else
  (incl. NextAuth `/api/auth/*`) → `frontend:3000`.
- `cf.vars` — your secret token + domain (git-ignored, Pi-only).

To change the domain later: edit `APP_DOMAIN` in `cf.vars`, update the Cloudflare DNS record,
and add the new Google redirect URI. Everything else derives from `APP_DOMAIN`.

---

## 2C. Public access — Cloudflare Tunnel

Modes A and B only reach the Pi from the home network: `home.aspiro.dev` was an **A record
pointing at `192.168.0.176`**, a private address published in public DNS, so from anywhere else
it simply did not route (and your LAN layout was visible to anyone who looked it up).

A Cloudflare Tunnel fixes both. `cloudflared` runs on the Pi, dials **out** to Cloudflare and
holds the connection open; the edge terminates TLS and hands requests back down it. **No router
port is opened, and no inbound firewall rule exists to get wrong.**

```
internet → Cloudflare edge → cloudflared (host systemd) → localhost:80 (caddy) → frontend:3000
                                                                          └→ backend:8000  (/api/v1/*)
                                              postgres — loopback only, never exposed
home WiFi → also the tunnel, since public DNS now points at Cloudflare;
            caddy:443 directly only if local DNS maps home.aspiro.dev → 192.168.0.176
SSH / admin → Tailscale
```

### One-time setup

1. **Create the tunnel** — Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a
   tunnel* → Cloudflared. Name it (e.g. `aspiro-pi`) and copy the **token**.
2. **Route the hostname** — **first delete the old `A home → 192.168.0.176` record** (DNS →
   Records). Cloudflare will not create the tunnel's CNAME while an A record of the same name
   exists, and this step used to say "delete it afterwards": that is how the hostname went
   unrouted from the tunnel's creation until 2026-10-06, with production reachable only from
   home while everything claimed it was public. Then, in the tunnel's **Published application
   routes** tab (formerly *Public hostname*; not *Hostname routes*, which is private WARP
   access), add `home` . `aspiro.dev` → **Service** `HTTP` → the origin:
   - `localhost:80` when `cloudflared` runs **on the host** — which is how the Pi actually runs
     it today (`cloudflared.service`, systemd, started with `--token`);
   - `caddy:80` only when it runs as the compose container below, inside `aspiro-network`.

   Check it took: `dig home.aspiro.dev @1.1.1.1` must return Cloudflare addresses, not
   `192.168.0.176`, and `journalctl -u cloudflared | grep "Updated to new configuration"`
   on the Pi must show the ingress rule.
3. **Give the Pi the token** — append to `caddy/cf.vars` on the Pi (git-ignored):
   ```
   CF_TUNNEL_TOKEN=eyJhIjoi...
   ```
4. **Nothing to switch on.** `cloudflared` sits behind a compose **profile** so it
   cannot start without a token (`tunnel run` would exit at once, and the restart
   policy would turn that into a crash loop beside healthy containers). Both deploy
   scripts activate the profile when they see a non-empty `CF_TUNNEL_TOKEN`, so
   step 3 is the switch — and a deploy can never delete a running tunnel by treating
   it as an orphan. Setting `COMPOSE_PROFILES=tunnel` by hand still works if you want
   to run it without a token in `cf.vars`.
5. **Bring it up**:
   ```bash
   docker compose --env-file .env --env-file caddy/cf.vars \
     -f docker-compose.pi.yml --profile tunnel up -d cloudflared
   docker logs aspiro-cloudflared | grep -i "registered tunnel connection"
   ```

Nothing else changes: the hostname, `NEXTAUTH_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS` and
the Google redirect URI all stay as they are — which is the reason for keeping the domain rather
than moving to a `*.ts.net` address.

### Why Caddy still sits behind it

The tunnel could point at `frontend:3000` and `backend:8000` with two ingress rules, but keeping
Caddy means **one** routing rule set for both the LAN and the tunnel. The Caddyfile declares an
explicit `http://` block for the domain so Caddy does **not** add its usual HTTP→HTTPS redirect
there: a redirect on the tunnel's origin would bounce the request back to `https://home.aspiro.dev`
— through the edge, into the tunnel, and round again.

### What to check after going public

- `TRUSTED_PROXY_COUNT=2` (set in `docker-compose.pi.yml`): cloudflared and Caddy both prepend to
  `X-Forwarded-For`, and the rate limiter reads the client from the end of that chain. Too low and
  every visitor shares one bucket, so one busy user throttles everyone.
- **Bot Fight Mode must stay off** (Security → Settings → Bot traffic). It answers datacenter
  IPs with a Managed Challenge that no script can pass, so the LINE webhook and the GitHub-hosted
  uptime probe both get a 403 that never reaches the Pi. On the free plan it cannot be exempted
  per path. *Block AI bots* and *AI Labyrinth* are separate and harmless here.
- Swagger and the dev routes must stay unreachable: `/api/v1/docs`, `/api/v1/openapi.json`,
  `/api/v1/dev/*` all answer 404 through the domain (`/docs` itself is a frontend path and just
  redirects to sign-in), because Caddy only proxies `/api/v1/*` to the
  backend and the dev router is not mounted outside development.
- Postgres stays bound to `127.0.0.1:5433` on the Pi — the tunnel exposes HTTP only, nothing else.

---

## 3. Load your data (optional)

A fresh Pi DB is empty (schema auto-created, only a `demo@aspiro.dev` user). Note the
**admin-approval gate**: new Google users are created `PENDING_APPROVAL` / inactive
(`backend/app/modules/users/services.py`), so a brand-new account can't log in until
approved — which is why the *first* Google login on an empty DB fails.

A fresh DB also has no `currencies` rows, so recording any transaction fails on the
`transactions.currency` foreign key until you seed them (idempotent; a no-op on a DB that
has them):

```bash
docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -v ON_ERROR_STOP=1 \
  < backend/scripts/seed/currencies.sql
```

And `alembic stamp head` there, so the deploy's schema gate has a revision to compare.

To use your real data, clone your laptop's local DB onto the Pi:

```bash
# On the laptop — dump the local Docker Postgres:
docker exec aspiro-postgres pg_dump -U aspiro_user -d aspiro_db \
  --no-owner --no-privileges --clean --if-exists > aspiro_db.sql
rsync -az aspiro_db.sql <user>@<pi-ip>:/home/<user>/

# On the Pi — replace the DB (drop+recreate avoids --clean's FK/constraint drop-ordering error):
docker stop aspiro-backend
docker exec aspiro-postgres psql -U aspiro_user -d postgres -c "DROP DATABASE IF EXISTS aspiro_db WITH (FORCE);"
docker exec aspiro-postgres psql -U aspiro_user -d postgres -c "CREATE DATABASE aspiro_db OWNER aspiro_user;"
docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -v ON_ERROR_STOP=1 < /home/<user>/aspiro_db.sql
docker start aspiro-backend
```

Or, to skip the clone and just unlock one account:
```sql
UPDATE users SET status='ACTIVE', is_active=true WHERE email='you@example.com';
```

> ⚠️ **The Pi DB is a point-in-time clone — it does not sync with production or your
> laptop.** They drift apart over time; re-run the clone to re-sync.

---

## 4. Operations

| Task | Command (on the Pi, `cd ~/Aspiro`) |
|------|-------------------------------------|
| Update code | Nothing deploys on its own. On the Pi, from a git clone kept beside the live tree (one-time: `git clone https://github.com/sc0210/Aspio.git ~/aspiro-src`): `cd ~/aspiro-src && git pull && bash scripts/pi/deploy-local.sh`. It rsyncs the checkout into `~/Aspiro` (secrets and data excluded), builds only the images whose source changed (on the Pi: 10–37 min for an app image, and the Pi has hung under such builds — prefer the mini PC), refuses code whose migrations the DB lacks (apply the `backend/scripts/prod_sql/` SQL + `alembic stamp head`, then re-run; `ASPIRO_SKIP_SCHEMA_GATE=1` overrides), and fails unless both app containers run the new images and are healthy (`scripts/pi/release_checks.sh`) — in which case it **rolls back by itself** to `aspiro-<svc>:previous`. `/health` reports the commit it was built from. From a laptop: `scripts/pi/deploy.sh`. **Roll back**: `git checkout <sha>` in `~/aspiro-src` and run `deploy-local.sh` again |
| Rebuild Caddy | `docker compose <-f files…> build caddy` — only after editing `caddy/Dockerfile`. `deploy-local.sh` does this for you when that file changes; the laptop-side `deploy.sh` never does |
| Apply a Caddyfile edit | Nothing — both deploy paths validate it and restart Caddy. By hand: `docker restart aspiro-caddy`, **not** `caddy reload` — see below |
| Logs | `docker compose <-f files…> logs -f frontend backend caddy` |
| Stop | `docker compose <-f files…> down` |
| Reboot | Automatic — all services use `restart: unless-stopped` + Docker is enabled on boot |
| Know it is down | Nothing — `.github/workflows/uptime.yml` probes `home.aspiro.dev` every ~15 min from a **GitHub-hosted** runner and keeps an issue open for the length of an outage. Nothing on the Pi can report its own outage: when it hung on 2026-09-25 the deploy alert and backup log went quiet with it, for ten days |
| Recover from a hang | Automatic since 2026-10-07: a 15 s hardware watchdog, `kernel.panic=10` and a 30 s journal flush, set by `scripts/pi/setup_hang_recovery.sh` (one-time, `/etc` is not in git — re-run it on a reflashed Pi). Raspberry Pi OS's own 1-minute watchdog did not recover a 12.7 h freeze that day. **Since 2026-10-08 a task blocked on I/O for 3 min also panics** (`hung_task_panic=1`, plus `panic_on_oops=1`), and Wi-Fi power save is off: outages of 8.5 h and 3.3 h followed with the watchdog in place, each boot ending with no kernel message. That points to a storage (SD card) stall rather than a frozen kernel — an inference: the trace of a stall is lost with the journal on the same card. A Pi that reboots every few minutes after this would mean the card itself is failing. Moving Docker/Postgres to a USB SSD is the root fix. The Pi is on **Wi-Fi**; Ethernet would remove one suspect for the hangs |
| Move off the SD card | `scripts/pi/migrate_to_usb_ssd.sh`. The SD card is the cause of the hangs: on 2026-10-09 the Pi froze at ~00:00 and stayed down 9.5 h until it was power-cycled by hand, past both the watchdog and `hung_task_panic`. With the SSD in a blue USB 3 port: `ssh -t scdev@192.168.0.176 '~/Aspiro/scripts/pi/migrate_to_usb_ssd.sh --check'`, then `ssh -t … 'sudo ~/Aspiro/scripts/pi/migrate_to_usb_ssd.sh --apply /dev/sda'` (takes a DB backup, erases the SSD after a typed confirmation, copies root twice — the second with the stack stopped — repoints PARTUUIDs, sets EEPROM `BOOT_ORDER=0xf14`), `sudo reboot`, then `--verify`. Run `--apply` from an interactive session (`-t`), not piped: it reads a confirmation. The SD card's system is left as it was (only the backup and the EEPROM staging files land on it), and USB-then-SD boot order means unplugging the SSD rolls back, losing whatever was written while running from the SSD. `--apply` refuses to start while a deploy is running. Any failure after the stack stops restarts it on the SD card |

### Don't pass a blanket `--build`

`caddy/Dockerfile` compiles Caddy from Go source with `xcaddy` (for the Cloudflare
DNS plugin). On this Pi's four ARM cores that is **9.7 minutes**, and it was being
paid on deploys that had nothing to do with Caddy: the deploy passed
`up -d --build`, and the `docker builder prune --max-used-space` at the end of
every deploy had evicted the Go layer to make room for the frontend's churn.
Images survive that prune; build cache does not.

So the deploy builds images **by name**, and `caddy` is on that list only when
`caddy/Dockerfile` itself changed — decided in `scripts/pi/rebuild_scope.sh`, which
`scripts/pi/rebuild_scope_test.sh` pins (including a guard that fails if that
Dockerfile ever starts copying from its build context, which would invalidate the
whole optimisation). That is safe because the Caddy image copies nothing from its
context: its content is a pure function of that one Dockerfile plus the upstream
`caddy:2` bases.

`up` with no `--build` still builds any service whose image is missing, so a fresh
Pi self-heals without a special step.

**Top-level `scripts/` is inert too.** Every build context is a subdirectory
(`./backend`, `./frontend`, `./caddy`), so each Dockerfile's `COPY . .` copies from its
own directory and nothing under the repo's `scripts/` can reach an image; the only
bind mount into a container is `caddy/Caddyfile`. A change there takes effect by being
*run* — `deploy-local.sh` and the helpers it sources execute from the checkout,
on the very deploy that carries them — so it costs no rebuild. Note
`backend/scripts/` is a different thing: it sits inside the backend context and does
rebuild the backend. A test fails if any build context stops being a subdirectory,
since that assumption is what makes this safe.

### A changed Caddyfile needs a restart, not a reload

`docker-compose.pi.yml` mounts `./caddy/Caddyfile` as a **single file**, and the
deploy's `rsync` (no `--inplace`) replaces it by writing a temp file and renaming it
over the target. That gives the file a new inode, and a single-file bind mount is
pinned to the old one — so the running container cannot see the edit at all.
Verified on the Pi with a throwaway container:

| after an rsync-style rename | container sees |
|---|---|
| nothing | **old content** |
| `caddy reload` | **old content** — exits 0, so the deploy goes green with the edit not applied |
| `docker restart` | new content |

That is why the deploy restarts Caddy (~1s blip) instead of reloading it. All of it
lives in `scripts/pi/caddy_config.sh`, used by both deploy paths, and is pinned by
`scripts/pi/deploy_local_plan_test.sh`.

Two details worth keeping:

**It is checked before it lands, not just before it is applied.** `deploy-local.sh`
validates the *incoming* Caddyfile before the rsync copies it, so a config that would
not start Caddy never reaches the live tree — that is what makes "production is
untouched" true. Once a bad file is on disk, the running container is only protected
while it holds its old inode, and the next reboot (this Pi has hard-reset under ARM
builds) would load it and crash-loop, taking out both LAN HTTPS and the tunnel origin.

Validation runs in a throwaway container built from `aspiro-caddy:latest`; the running
container would check the stale inode, and vanilla `caddy:2` cannot parse
`dns cloudflare`. `caddy validate` is used rather than `caddy adapt` because adapt only
converts Caddyfile to JSON and accepts configs that cannot start — `reverse_proxy` with
no upstream adapts cleanly (exit 0) and then crash-loops Caddy. The cost is that
validate provisions modules, so it needs the real `CF_API_TOKEN` (the Cloudflare module
rejects an implausible one); that is a local format check, not a call to Cloudflare, so
it stays offline and deterministic.

Three things follow from that, each pinned by a test:

- **A rebuilt Caddy image is checked too**, even when nobody touched the Caddyfile: a
  plugin bump can stop an untouched config parsing, and `up` would recreate Caddy onto
  it. So is the case where Caddy is running an image other than what
  `aspiro-caddy:latest` now points at — a deploy that built a new image and then failed
  leaves that tag moved, and the next unrelated deploy would recreate Caddy onto the
  build that was rejected.
- **When `caddy/Dockerfile` and the Caddyfile change together**, the pre-rsync gate
  stands down (the new image decides which directives parse) and the check happens
  after the build instead. The unvalidated file therefore sits on disk for the ~10
  minute ARM build — the one window where a hard reset could crash-loop Caddy.
- **The manual `scripts/pi/deploy.sh` cannot gate before landing**, because its rsync
  runs from the Mac before anything is checked. It validates what arrived and refuses to
  restart Caddy onto it, and prints how to recover the served config from the running
  container.

**It decides from the state of the box, not from what this deploy changed.** A deploy
that dies after the `rsync` — a failed build, a dropped ssh session — leaves the new
Caddyfile on disk with Caddy still on the old inode. A delta-based check would see
nothing to do on every later deploy and stay green forever, with the edit stranded.
So the check compares what the container is serving against the file on disk, which
cannot drift:

```bash
docker exec aspiro-caddy cat /etc/caddy/Caddyfile | cmp -s - caddy/Caddyfile
```

---

## 5. Caveats & gotchas

- **`quickchart`** is amd64-only, so the self-hosted renderer is omitted on the Pi and the
  backend falls back to the **public** `quickchart.io` (set explicitly in
  `docker-compose.pi.yml`). LINE chart rendering works, but the chart payload leaves the
  network — unlike the local/prod stacks, which self-host it so financial data stays in-network.
- **Pin the Pi's IP** with a DHCP reservation (or static IP). The DNS A record and IP-mode URLs break if the IP changes on reboot.
- **Google login needs Mode B.** Over a raw IP, use email/password or demo mode.
- **Service workers / PWA install** only work over HTTPS (Mode B) or `localhost` — not `http://<ip>`.
- **`cf.vars` holds a secret** — keep it `chmod 600`, never commit it.
- The `caddy` container keeps `CF_API_TOKEN` in its config, so **cert auto-renewal survives reboots**.

---

## 6. The Pi's production stack

The lighter build described in earlier revisions of this doc is no longer a TODO: it ships as
**`docker-compose.pi.yml`**, the standalone stack both deploy scripts run. It uses a precompiled
Next.js production image (`frontend/Dockerfile`, `output: 'standalone'`), runs the backend
without `--reload` at `--workers 3`, drops `pgadmin` (and `quickchart`, which is amd64-only),
and serves through Caddy. Run it with `docker compose -f docker-compose.pi.yml` — see the file's
header comment at the top of the repo for the exact commands.
