# Mac local DB — automatic backups (LaunchAgent)

The Mac's Docker `aspiro-postgres` holds **important local data that is separate
from the Pi** (not a mirror). This LaunchAgent backs it up daily.

- **Agent:** `dev.aspiro.backup.plist` → installed at `~/Library/LaunchAgents/`
- **Schedule:** daily **12:00** (if the Mac is asleep then, launchd runs it once on wake)
- **Output:** `~/aspiro-backups/mac-db/aspiro_*.sql.gz`, 30-day retention
- **Log:** `~/aspiro-backups/mac-backup.log`
- Uses the same `scripts/backup_db.sh` (dumps whichever local `aspiro-postgres` container exists).

## ⚠️ macOS gotcha (why the script is copied)

A LaunchAgent **cannot execute a script that lives under `~/Documents/`**
(also Desktop/Downloads) — macOS TCC blocks it with `Operation not permitted`
(exit 126), even though running it by hand in Terminal works. So the agent runs a
**copy** placed in a non-protected location: `~/aspiro-backups/backup_db.sh`.

**If you change `scripts/backup_db.sh`, re-copy it:**

```bash
cp scripts/backup_db.sh ~/aspiro-backups/backup_db.sh && chmod +x ~/aspiro-backups/backup_db.sh
```

## Install

```bash
# 1. place the runnable copy outside ~/Documents
cp scripts/backup_db.sh ~/aspiro-backups/backup_db.sh && chmod +x ~/aspiro-backups/backup_db.sh

# 2. install + load the agent
cp scripts/mac/dev.aspiro.backup.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.aspiro.backup.plist

# 3. test it via launchd (not just a manual run)
launchctl kickstart -k gui/$(id -u)/dev.aspiro.backup
launchctl list | grep aspiro        # last column 0 = success
tail ~/aspiro-backups/mac-backup.log
```

To remove: `launchctl bootout gui/$(id -u)/dev.aspiro.backup && rm ~/Library/LaunchAgents/dev.aspiro.backup.plist`

## Notes

- Docker must be running at 12:00 for the backup to succeed (else it exits and logs an error).
- Paths in the plist are absolute (`/Users/samchen/...`); adjust if the username differs.
- Offsite: **enabled** — the plist sets `RCLONE_REMOTE=r2:aspiro-backups/mac`, so each backup uploads to Cloudflare R2 under the `mac/` prefix (the Pi's live under `pi/`). rclone must be installed (`brew install rclone`) and `~/.config/rclone/rclone.conf` present (copied from the Pi). The plist PATH already includes `/opt/homebrew/bin`. See `docs/PI_BACKUPS.md` for the R2 setup + gotchas.
- Monitoring: the plist sets `PING_URL` to a **healthchecks.io** check. The script pings it on success (dead-man's switch) and `PING_URL/fail` on an offsite failure, and exits non-zero — so a failed offsite **alerts** instead of hiding silently. The real ping token lives only in the installed `~/Library/LaunchAgents` copy; the repo copy has a `YOUR-UUID` placeholder.
