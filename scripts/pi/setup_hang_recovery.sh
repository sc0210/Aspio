#!/usr/bin/env bash
# One-time host setup ON the Pi: make a hang reboot the Pi instead of sitting frozen.
# Not part of any deploy — /etc is not in git. Re-run on a rebuilt or reflashed Pi:
#   ssh scdev@192.168.0.176 'bash -s' < scripts/pi/setup_hang_recovery.sh
# Idempotent: it rewrites the same files and reloads.
set -euo pipefail

# 1. systemd hardware watchdog at 15s: within the BCM2835's ~15s hardware limit, so
#    the hardware itself enforces the deadline. RPi OS ships 1m
#    (/usr/lib/systemd/system.conf.d/40-rpi-enable-watchdog.conf), which relies on
#    the kernel re-arming the timer in between — and a 12.7h freeze on 2026-10-07
#    was not recovered by it. /etc overrides /usr/lib.
sudo mkdir -p /etc/systemd/system.conf.d
printf '%s\n' '# Aspiro: hang recovery (2026-10-07). See docs/RASPBERRY_PI_DEPLOYMENT.md.' \
  '[Manager]' 'RuntimeWatchdogSec=15s' 'RebootWatchdogSec=2min' \
  | sudo tee /etc/systemd/system.conf.d/90-aspiro-watchdog.conf >/dev/null

# 2. A kernel panic reboots after 10s instead of halting. (This kernel has no
#    soft-lockup detector, so kernel.softlockup_panic does not exist here.)
#
#    And a task stuck in uninterruptible I/O for 3 minutes is a panic. Added
#    2026-10-08 after three outages of 12.6h, 8.5h and 3.3h in 30 hours, the last
#    one with the 15s watchdog already in place: each boot just stops, with no
#    kernel message, while systemd keeps petting the watchdog. That is the shape
#    of a storage stall (SD card), which never panics and whose "blocked for more
#    than 120 seconds" warnings are lost with the journal on the same card. 180s,
#    not the 120s default: deploys build their images on this Pi, and a heavy
#    build's long I/O wait should not reboot it.
printf '%s\n' '# Aspiro: hang recovery (2026-10-07, I/O stalls 2026-10-08).' \
  'kernel.panic = 10' 'kernel.panic_on_oops = 1' \
  'kernel.hung_task_timeout_secs = 180' 'kernel.hung_task_panic = 1' \
  | sudo tee /etc/sysctl.d/90-aspiro-hang-recovery.conf >/dev/null
# A kernel built without the hung-task detector has no such knobs; say so loudly
# rather than letting set -e abort the rest of the setup.
sudo sysctl -q -p /etc/sysctl.d/90-aspiro-hang-recovery.conf \
  || echo "WARN: some keys unsupported by this kernel — check the verify output below"

# 3. Journal flushed every 30s (default 5m), so a freeze leaves its last minutes.
printf '%s\n' '# Aspiro: keep the last moments before a hang (2026-10-07).' '[Journal]' 'SyncIntervalSec=30s' \
  | sudo tee /etc/systemd/journald.conf.d/90-aspiro-sync.conf >/dev/null

# 4. Wi-Fi power saving off. The Pi is on Wi-Fi, and brcmfmac power save is a
#    known cause of a Pi dropping off the network. Persisted on every saved Wi-Fi
#    connection, and applied to the live device without reconnecting (so it does
#    not cut the SSH session running this).
if command -v nmcli >/dev/null; then
  nmcli -t --escape no -f NAME,TYPE connection show | awk -F: '$NF == "802-11-wireless" {NF--; print}' OFS=: |
    while IFS= read -r con; do
      sudo nmcli connection modify "$con" 802-11-wireless.powersave 2 || echo "WARN: power save not set on $con"
    done
  sudo nmcli device modify wlan0 802-11-wireless.powersave 2 >/dev/null || true
else
  echo "WARN: no NetworkManager — turn Wi-Fi power save off another way"
fi

sudo systemctl daemon-reexec
sudo systemctl restart systemd-journald

echo "--- verify"
systemctl show -p RuntimeWatchdogUSec -p RebootWatchdogUSec
for k in panic hung_task_panic hung_task_timeout_secs panic_on_oops; do
  printf 'kernel.%s=%s  ' "$k" "$(cat /proc/sys/kernel/$k 2>/dev/null || echo MISSING)"
done; echo
if command -v nmcli >/dev/null; then
  nmcli -t --escape no -f NAME,TYPE connection show | awk -F: '$NF == "802-11-wireless" {NF--; print}' OFS=: |
    while IFS= read -r con; do
      echo "wifi powersave [$con]=$(nmcli -g 802-11-wireless.powersave connection show "$con")"
    done
fi
journalctl -b -o cat --no-pager | grep -i 'watchdog running' | tail -1
systemd-analyze cat-config systemd/journald.conf 2>/dev/null | grep -i SyncIntervalSec | tail -1
