# Moving production from the Pi to a mini PC (Ubuntu, x86)

Production runs on a Raspberry Pi 4 booting from a microSD card, and the card is failing: hangs that only a power cycle recovers (2026-10-07, 10-08, 10-09). The plan is to move the whole stack to a mini PC with an SSD running Ubuntu Server once the proof of value is done. This is the runbook, written from what the Pi actually runs (inventoried 2026-10-09). Delete it once the move is done and `RASPBERRY_PI_DEPLOYMENT.md` describes the mini PC.

## What moves

| On the Pi | What it is | On the mini PC |
|---|---|---|
| `~/Aspiro` (rsync'd by `deploy-local.sh`, **not a git checkout**) | compose stack: `postgres`, `backend`, `frontend`, `caddy` (`docker-compose.pi.yml`) | same path, same compose file |
| `~/Aspiro/.env`, `~/Aspiro/caddy/cf.vars` | secrets and Caddy/Cloudflare settings | copy as-is |
| Docker volume `aspiro_postgres_data` | the database | **not copied**: restored from a `pg_dump` (portable across architectures; the raw volume is not guaranteed to be) |
| `cloudflared.service` (host systemd, origin `http://localhost:80`) | the public route to `home.aspiro.dev` | new connector on the mini PC. **Use a fresh tunnel token** and revoke the old one: the current token was printed into a session log on 2026-10-09 |
| `~/aspiro-src` (a git clone) | where deploys run from: `git pull && bash scripts/pi/deploy-local.sh` | `git clone https://github.com/sc0210/Aspio.git ~/aspiro-src` |
| `tailscaled.service` | SSH/admin from outside the LAN | `tailscale up` on the mini PC |
| crontab: `backup_db.sh` nightly at 03:30 plus an `@reboot` catch-up | DB backup with off-site copy to R2 | same two lines |
| `~/.config/aspiro-backup.conf`, `~/.config/rclone/rclone.conf` | backup settings, R2 credentials | copy as-is |

**Pi-only, not to carry over:** `scripts/pi/setup_hang_recovery.sh` (BCM2835 watchdog, Wi-Fi power save), `scripts/pi/migrate_to_usb_ssd.sh` and the EEPROM boot order.

**Images:** nothing is prebuilt; `deploy-local.sh` builds on the host. That takes minutes on x86, not the 10–37 the Pi needs.

## Steps

Everything up to step 5 runs while the Pi keeps serving.

1. **Prepare the mini PC.**
   - Install Ubuntu Server LTS and give it a DHCP reservation or a static LAN IP.
   - Create the user `scdev`.
   - Install Docker Engine and the compose plugin (from Docker's apt repository), then `sudo usermod -aG docker scdev`.
   - Install `rsync`, `rclone` and `postgresql-client`, and run `tailscale up`.
2. **Copy the app directory and configs from the Pi** (run on the mini PC):
   ```bash
   rsync -a --exclude node_modules --exclude .deploy-state scdev@192.168.0.176:Aspiro/ ~/Aspiro/
   mkdir -p ~/.config/rclone ~/aspiro-backups/db
   scp scdev@192.168.0.176:.config/aspiro-backup.conf ~/.config/
   scp scdev@192.168.0.176:.config/rclone/rclone.conf ~/.config/rclone/
   ```
3. **Build and start the database only:**
   ```bash
   cd ~/Aspiro
   docker compose -f docker-compose.pi.yml build
   docker compose -f docker-compose.pi.yml up -d postgres
   ```
4. **Rehearse the restore** with last night's dump, before the real cutover. **Never with the scheduler or outbound channels on:** the backend runs every scheduled job in-process, so a second live backend would send users duplicate LINE and email notifications and write to the copy. Use a rehearsal override for every `up` in this step:
   ```bash
   cat > ~/rehearsal.override.yml <<'YML'
   services:
     backend:
       environment:
         - ENABLE_SCHEDULER=false
         - LINE_CHANNEL_ACCESS_TOKEN=
         - LINE_CHANNEL_SECRET=
         - SMTP_HOST=
   YML
   alias dc='docker compose -f docker-compose.pi.yml -f ~/rehearsal.override.yml'
   ```
   Then:
   - Copy `~/aspiro-backups/db/<newest>.sql.gz` from the Pi.
   - Restore it with `gunzip -c dump.sql.gz | docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -v ON_ERROR_STOP=1`.
   - Start the stack with `dc up -d` and check it the way the uptime probe does: `curl -s -o /dev/null -w '%{http_code}' http://localhost/` should return `200` (frontend), and the same for `http://localhost/api/v1/users/me` should return `401` (backend answering). `/health` is not routed through Caddy.
5. **Cutover.** The site is down for the length of a dump and restore, a few minutes. Order matters: two live tunnel connectors share traffic, so writes would land in both databases.
   0. **Pi:** make sure no `deploy-local.sh` is running, and don't start one until the cutover is done: a deploy landing mid-cutover would restart the Pi's backend and write after the final dump.
   1. **Pi:** `docker compose -f docker-compose.pi.yml stop backend frontend`. This stops writes; Postgres stays up.
   2. **Pi:** `~/Aspiro/scripts/backup_db.sh`. This is the final dump.
   3. **Mini PC:** recreate the database from that dump:
      - `docker compose -f docker-compose.pi.yml down`
      - remove the `aspiro_postgres_data` volume
      - `up -d postgres`
      - restore the final dump as in step 4
      - `up -d` with the **real** compose files: no rehearsal override, so the scheduler and notifications are on.
   4. **Check the data matches.** Run on both machines:
      ```sql
      SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM transactions), (SELECT count(*) FROM portfolio_holdings),
             (SELECT count(*) FROM debt_accounts), (SELECT count(*) FROM goals), (SELECT version_num FROM alembic_version);
      ```
      The numbers must be equal.
   5. **Pi:** `sudo systemctl disable --now cloudflared`.
   6. **Mini PC:** `sudo cloudflared service install <fresh token from the Cloudflare dashboard>`. `home.aspiro.dev` now serves from the mini PC, with no DNS change.
   7. **Check:** `https://home.aspiro.dev/` returns 200 and `https://home.aspiro.dev/api/v1/users/me` returns 401. Log in, and check a recent transaction is there.
6. **Deploys:** on the mini PC, `git clone https://github.com/sc0210/Aspio.git ~/aspiro-src`, then deploy once with `cd ~/aspiro-src && bash scripts/pi/deploy-local.sh` to confirm it builds and verifies.
7. **Backups:**
   - Add the two crontab lines from the table above, with the same paths.
   - Run `~/Aspiro/scripts/backup_db.sh` once by hand and confirm the "Offsite (rclone) OK" line, so the R2 copy works from the new host.
8. **Then:**
   - Update `RASPBERRY_PI_DEPLOYMENT.md` and the deployment paragraph in `CLAUDE.md`, which currently says the Pi is all of production.
   - Update the hard-coded `192.168.0.176` in `uptime.yml`'s recovery hints.
   - Delete this file.

## Rollback

Until step 6, the Pi is untouched apart from its stack being stopped. To roll back, run on the mini PC `sudo systemctl disable --now cloudflared`, then on the Pi `docker compose -f docker-compose.pi.yml up -d`, `sudo systemctl enable --now cloudflared`. Anything written on the mini PC after the cutover is not on the Pi; take a `pg_dump` there first if it matters.
