# Raspberry Pi — Database Backups & Cloud Fallback

The Pi is the **primary** production host (`home.aspiro.dev`), with Supabase as a
**cloud fallback**. Because the Pi's Postgres lives on a **single SD card**
(`/dev/mmcblk0p2`), an offsite copy is not optional — an SD-card failure would
otherwise lose everything.

> ⚠️ **SD-card caveat:** Postgres currently runs on the SD card (Docker volume
> `postgres_data` on `/`). SD cards wear out and are slow. When convenient, move
> the DB to a USB SSD and re-point the volume. Until then, backups are your only
> safety net — keep the offsite copy healthy.

## What's installed (on the Pi)

| Piece | Value |
|---|---|
| Script | `~/Aspiro/scripts/backup_db.sh` (`docker exec … pg_dump | gzip`) |
| Schedule | user cron, **daily 03:30** (`crontab -l`, marker `# aspiro-db-backup`) |
| Local dir | `~/aspiro-backups/db/aspiro_YYYYMMDD_HHMMSS.sql.gz` |
| Retention | `KEEP_DAYS=14` (local prune) |
| Log | `~/aspiro-backups/backup.log` |

The dump uses `--no-owner --no-privileges --schema=public`, so it restores
cleanly into **any** Postgres — the local container, a scratch DB, or Supabase.

The script is self-verifying: it writes to a `.partial` file, runs `gzip -t`, and
refuses to keep a dump that fails the integrity check or is suspiciously small.

## Run a backup manually

```bash
ssh scdev@192.168.0.176
BACKUP_DIR=~/aspiro-backups/db KEEP_DAYS=14 ~/Aspiro/scripts/backup_db.sh
```

## Restore

Into the **live** Pi DB (interactive; asks for confirmation):

```bash
~/Aspiro/scripts/restore_db.sh                    # pick from the list
~/Aspiro/scripts/restore_db.sh <file.sql.gz>      # a specific file
```

Verify a dump is restorable **without touching production** (a good monthly drill):

```bash
F=$(ls -t ~/aspiro-backups/db/aspiro_*.sql.gz | head -1)
docker exec aspiro-postgres psql -U aspiro_user -d postgres -qc "CREATE DATABASE aspiro_restore_test;"
gunzip -c "$F" | docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_restore_test -q >/dev/null
docker exec aspiro-postgres psql -U aspiro_user -d aspiro_restore_test -tAc \
  "select 'users='||count(*) from users union all select 'transactions='||count(*) from transactions;"
docker exec aspiro-postgres psql -U aspiro_user -d postgres -qc "DROP DATABASE aspiro_restore_test;"
```

## Offsite copy (enable one)

The backup script ships a copy offsite when the matching env var is set. Put these
in the cron line (or an env file the cron sources).

### The offsite step waits, and catches up

Two behaviours worth knowing before you read a log:

- **It waits for the remote** before uploading, doubling from 5s over 6 attempts
  (~2.5 min). A scheduled run can start before the network is up — on macOS
  launchd fires the job the moment the clock matches, including straight out of
  sleep, and rclone dies on `no such host` while the same command works by hand
  seconds later. Tune with `OFFSITE_RETRIES` / `OFFSITE_RETRY_DELAY`.
- **It reconciles after a successful upload**, shipping any earlier dump the
  remote is missing. Without this a failed night stranded that backup for good,
  because the next run only ever uploaded its own file — which is how 29 dumps
  accumulated locally, unnoticed, while every run looked healthy.

Both failures are loud: a catch-up that cannot upload, or cannot even list the
remote, sets the offsite-failed flag, so the dead-man's-switch ping goes to
`/fail` and the script exits 2. **The local backup is never affected by an
offsite failure.**

### A nightly cron only fires if the machine is on

Across five weeks the Pi's 03:30 job ran **nine times** — it spends nights
powered down, and cron has no catch-up, so every missed night was silent. Pair
the nightly entry with a boot-time companion that runs only if nothing recent
exists:

```cron
30 3 * * * . ~/.config/aspiro-backup.conf; ~/Aspiro/scripts/backup_db.sh >> ~/aspiro-backups/backup.log 2>&1  # aspiro-db-backup
@reboot sleep 120; . ~/.config/aspiro-backup.conf; ~/Aspiro/scripts/backup_db.sh --if-stale 20 >> ~/aspiro-backups/backup.log 2>&1  # aspiro-db-backup-boot
```

`--if-stale HOURS` exits immediately when a dump newer than HOURS already
exists, so a normal reboot costs nothing and a reboot after a missed night takes
the backup. The `sleep 120` gives the network a head start; the offsite retry
loop covers the rest.

Checking freshness is the one thing no script does for you:

```bash
rclone lsl r2:aspiro-backups/pi/  | sort -k2 | tail -3
rclone lsl r2:aspiro-backups/mac/ | sort -k2 | tail -3
```

**Option A — Cloudflare R2 (recommended; durable, cheap, you already use CF):**

```bash
# one-time, on the Pi:
curl https://rclone.org/install.sh | sudo bash
rclone config     # new remote "r2", type=s3, provider=Cloudflare, add R2 token + endpoint
rclone mkdir r2:aspiro-backups
# then add to the cron env:
RCLONE_REMOTE=r2:aspiro-backups
```

**Option B — push to another LAN box via scp (free, no account):**

```bash
BACKUP_SCP_DEST=user@192.168.0.10:~/aspiro-offsite   # needs the Pi's key authorized there
```

**Option C — monitoring ping** (know when a backup silently stops running):

```bash
PING_URL=https://hc-ping.com/<your-uuid>             # e.g. healthchecks.io, curl'd on success
```

## Cloud fallback — Supabase warm standby

Keep Supabase a recent mirror of the Pi so you can flip DNS to it if the Pi dies.
Because the dump is `--no-owner --no-privileges --schema=public`, it loads into
Supabase's `public` schema. Run this **weekly** (needs the Supabase connection
string; test once by hand before automating):

```bash
F=$(ls -t ~/aspiro-backups/db/aspiro_*.sql.gz | head -1)
# DROP+recreate only the public schema (leaves auth/storage/extensions intact):
psql "$SUPABASE_DB_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c "$F" | psql "$SUPABASE_DB_URL"
# re-apply RLS (see backend/migrations/enable_rls_all_tables.sql)
```

> Supabase's pooler needs the transaction-mode port `:6543` for the app, but use
> the **direct** connection (`:5432`) for a full restore like this.

## Failover checklist (Pi down → serve from cloud)

1. Confirm Supabase has a recent mirror (run the warm-standby step above).
2. Point the frontend's `NEXT_PUBLIC_API_URL` / backend `DATABASE_URL` at the cloud.
3. Re-apply any `PROD PENDING` SQL (RLS, snapshot indexes) that only lived on the Pi.
