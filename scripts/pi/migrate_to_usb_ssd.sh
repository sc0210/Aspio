#!/usr/bin/env bash
# Move the Pi's whole system (OS, Docker, Postgres) from the SD card to a USB SSD.
#
# Why: the SD card is the cause of the outages. Hangs that neither the 15 s
# hardware watchdog nor hung_task_panic recover, ending only when someone
# power-cycles the Pi (2026-10-07, 10-08, overnight 10-09). See
# docs/RASPBERRY_PI_DEPLOYMENT.md and PR #501.
#
# Run ON the Pi, in three steps, with the SSD plugged into a blue USB 3 port:
#
#   ./migrate_to_usb_ssd.sh --check                 # read-only: what would happen
#   sudo ./migrate_to_usb_ssd.sh --apply /dev/sda   # erases /dev/sda, copies, sets boot order
#   sudo reboot                                     # boots from the SSD
#   ./migrate_to_usb_ssd.sh --verify                # after the reboot
#
# The SD card's system is left as it was — only the fresh DB backup and the
# EEPROM update's staging files are written to it. The boot order becomes USB
# first, then SD, so if the SSD fails or is unplugged the Pi boots from the SD
# card. Rollback: unplug the SSD and reboot; anything written while running
# from the SSD (new transactions, prices) is not on the SD card.
set -euo pipefail

PATH="/usr/local/sbin:/usr/sbin:/sbin:$PATH"
REPO=/home/scdev/Aspiro
# The same env files, in the same order, as deploy-local.sh: docker-compose.pi.yml has
# required secrets (${VAR:?}), so compose refuses even `stop` unless it can read them.
# caddy/cf.vars only exists on a LAN-HTTPS host, so pass it only when present.
COMPOSE=(docker compose --env-file "$REPO/.env")
[ -f "$REPO/caddy/cf.vars" ] && COMPOSE+=(--env-file "$REPO/caddy/cf.vars")
COMPOSE+=(-f "$REPO/docker-compose.pi.yml")
MNT=/mnt/ssd-migrate
BOOT_ORDER=0xf14   # read right to left: 4 = USB, 1 = SD card, f = restart and retry

die() { echo "ERROR: $*" >&2; exit 1; }

# Set once the site is down: every failure from then on restarts it on the SD card.
STACK_STOPPED=0
RUNNER_STOPPED=0
on_exit() {
    local rc=$?
    [ "$rc" -eq 0 ] && return
    umount -R "$MNT" 2>/dev/null || true
    if [ "$STACK_STOPPED" = 1 ]; then
        echo "FAILED — restarting the stack on the SD card" >&2
        systemctl start docker || true
        "${COMPOSE[@]}" up -d || true
    fi
    if [ "$RUNNER_STOPPED" = 1 ]; then
        systemctl start 'actions.runner.*' 2>/dev/null || true
    fi
}
say() { echo "== $*"; }

root_src() { findmnt -n -o SOURCE /; }

# Point a copied system at its new partitions. Fails (non-zero) unless both
# files end up naming the new root: a config that names root some other way
# (/dev/mmcblk0p2, a LABEL) must stop the migration, not produce an SSD that
# boots the SD card's root or none at all.
repoint_partuuids() {
    local cmdline=$1 fstab=$2 old_boot=$3 old_root=$4 new_boot=$5 new_root=$6
    sed -i "s/PARTUUID=$old_root/PARTUUID=$new_root/" "$cmdline"
    sed -i -e "s/PARTUUID=$old_boot/PARTUUID=$new_boot/" -e "s/PARTUUID=$old_root/PARTUUID=$new_root/" "$fstab"
    grep -q "root=PARTUUID=$new_root" "$cmdline" && grep -Eq "^PARTUUID=$new_root[[:space:]]" "$fstab" \
        && grep -Eq "^PARTUUID=$new_boot[[:space:]]" "$fstab"
}

usb_disks() { lsblk -dno NAME,SIZE,TRAN,MODEL | awk '$3 == "usb" {print}'; }

check() {
    say "running from: $(root_src)"
    case "$(root_src)" in
        /dev/mmcblk*) echo "   (SD card — migration not done yet)" ;;
        /dev/sd*) echo "   (already on a USB disk — nothing to migrate)" ;;
    esac
    say "USB disks attached"
    usb_disks | sed 's/^/   /' || true
    [ -n "$(usb_disks)" ] || echo "   none — plug the SSD into a blue USB 3 port"
    say "space needed: $(df -h --output=used / | tail -1 | tr -d ' ') of root + boot"
    say "EEPROM boot order: $(rpi-eeprom-config 2>/dev/null | grep -i BOOT_ORDER || echo 'default (SD first, then USB)') -> will set $BOOT_ORDER"
    say "newest DB backup: $(ls -t ~/aspiro-backups/db/*.sql.gz 2>/dev/null | head -1 || echo none)"
    say "tools"
    for t in sfdisk mkfs.vfat mkfs.ext4 blkid rsync rpi-eeprom-config; do
        printf '   %-18s %s\n' "$t" "$(command -v "$t" >/dev/null && echo ok || echo MISSING)"
    done
    echo
    echo "Next: sudo $0 --apply /dev/sdX   (the SSD's name above; it will be ERASED)"
}

apply() {
    local dev="${1:-}"
    [ "$(id -u)" = 0 ] || die "run --apply with sudo"
    [ -n "$dev" ] || die "name the SSD, e.g. --apply /dev/sda"
    [ -b "$dev" ] || die "$dev is not a block device"
    case "$dev" in /dev/mmcblk*) die "$dev is the SD card — refusing";; esac
    [ "$(lsblk -dno TRAN "$dev")" = usb ] || die "$dev is not a USB disk — refusing"
    case "$(root_src)" in /dev/mmcblk*) ;; *) die "not running from the SD card — already migrated?";; esac
    if lsblk -no MOUNTPOINT "$dev" | grep -q .; then die "$dev has mounted partitions — unmount them first"; fi
    local used_k ssd_k
    used_k=$(df -k --output=used / | tail -1)
    ssd_k=$(( $(blockdev --getsize64 "$dev") / 1024 ))
    [ "$ssd_k" -gt $(( used_k + 2 * 1024 * 1024 )) ] || die "$dev is too small for $(( used_k / 1024 / 1024 )) GB of data"

    # Stopping the runner mid-deploy would cut a `compose up` in half: check now,
    # before asking for confirmation, and again after stopping it below.
    if pgrep -f Runner.Worker >/dev/null; then die "a deploy is running on this Pi — retry when it finishes"; fi

    lsblk -o NAME,SIZE,MODEL "$dev"
    echo
    read -r -p "Type ERASE $dev to wipe it and copy the system onto it: " answer
    [ "$answer" = "ERASE $dev" ] || die "not confirmed — nothing changed"

    trap on_exit EXIT

    # A deploy landing mid-migration would write to the SD card's database after
    # the copy and be lost on reboot. The runner comes back on its own from the SSD.
    if [ -n "$(systemctl list-units 'actions.runner.*' --no-legend 2>/dev/null)" ]; then
        RUNNER_STOPPED=1  # set first: on_exit restarts it whatever happens next
        systemctl stop 'actions.runner.*' || die "could not stop the deploy runner"
        # A job assigned in the second between the check above and the stop may be
        # cut off; this catches it only if the worker outlived the unit. Narrow and
        # accepted: such a deploy shows as failed in Actions — re-run it afterwards.
        if pgrep -f Runner.Worker >/dev/null; then die "a deploy started just now — retry when it finishes"; fi
    fi

    say "1/7 fresh database backup (aborts if it fails)"
    sudo -u scdev bash -c ". ~/.config/aspiro-backup.conf; $REPO/scripts/backup_db.sh"

    say "2/7 partition $dev: 512 MB boot (FAT32) + the rest for root (ext4)"
    wipefs -a "$dev" >/dev/null
    printf 'label: dos\n,512M,c,*\n,,83\n' | sfdisk --quiet "$dev"
    partprobe "$dev" 2>/dev/null || true
    udevadm settle 2>/dev/null || sleep 2
    local p1 p2
    p1=$(lsblk -lnpo NAME "$dev" | sed -n 2p)
    p2=$(lsblk -lnpo NAME "$dev" | sed -n 3p)
    mkfs.vfat -F 32 -n BOOTFS "$p1" >/dev/null
    mkfs.ext4 -q -F -L rootfs "$p2"

    say "3/7 copy the boot partition"
    mkdir -p "$MNT"
    mount "$p2" "$MNT"
    mkdir -p "$MNT/boot/firmware"
    mount "$p1" "$MNT/boot/firmware"
    rsync -rt --delete /boot/firmware/ "$MNT/boot/firmware/"

    # -x: root's own filesystem only, so running containers' overlay mounts are
    # not copied a second time (and /boot/firmware is copied separately above).
    local excludes=(--exclude=/proc/* --exclude=/sys/* --exclude=/dev/* --exclude=/run/* --exclude=/tmp/*
                    --exclude=/mnt/* --exclude=/media/* --exclude=/lost+found --exclude=/boot/firmware/*)
    say "4/7 first copy of root while the site runs (the long part)"
    # Exit 24 = files vanished mid-copy: routine with Docker and Postgres live,
    # and the second pass below copies the final state anyway.
    rsync -aAXHx --numeric-ids --info=progress2 "${excludes[@]}" / "$MNT/" || [ $? -eq 24 ]

    say "5/7 stop the stack and copy again, so the database is consistent"
    # From here the site is down until the reboot; on_exit restarts it on the SD
    # card if anything below fails (including a die()).
    STACK_STOPPED=1
    "${COMPOSE[@]}" stop
    systemctl stop docker docker.socket
    rsync -aAXHx --numeric-ids --delete "${excludes[@]}" / "$MNT/"

    say "6/7 point the SSD at itself (PARTUUIDs in cmdline.txt and fstab)"
    local old_boot old_root new_boot new_root
    old_boot=$(blkid -s PARTUUID -o value /dev/mmcblk0p1)
    old_root=$(blkid -s PARTUUID -o value /dev/mmcblk0p2)
    new_boot=$(blkid -s PARTUUID -o value "$p1")
    new_root=$(blkid -s PARTUUID -o value "$p2")
    repoint_partuuids "$MNT/boot/firmware/cmdline.txt" "$MNT/etc/fstab" \
        "$old_boot" "$old_root" "$new_boot" "$new_root" \
        || die "cmdline.txt/fstab don't name the SD card by PARTUUID — SSD left unbootable, nothing switched over"
    sync
    umount "$MNT/boot/firmware" "$MNT"

    say "7/7 boot order: USB first, SD card as fallback"
    local cfg
    cfg=$(mktemp)
    rpi-eeprom-config > "$cfg"
    sed -i '/^BOOT_ORDER=/d' "$cfg"
    echo "BOOT_ORDER=$BOOT_ORDER" >> "$cfg"
    rpi-eeprom-config --apply "$cfg"
    rm -f "$cfg"
    trap - EXIT

    echo
    echo "Done. The site and the deploy runner are DOWN until you reboot — do it now."
    echo "Now: sudo reboot   — then run: $0 --verify"
    echo "If it does not come back: unplug the SSD and power-cycle; the Pi boots from the SD card as before."
}

verify() {
    local src
    src=$(root_src)
    say "root: $src"
    case "$src" in
        /dev/sd*) echo "   OK — running from the USB SSD" ;;
        *) echo "   still on $src — the SSD did not boot (check the boot order, or the SSD's port)"; exit 1 ;;
    esac
    say "boot order: $(rpi-eeprom-config | grep BOOT_ORDER || echo default)"
    say "containers"
    docker ps --format '   {{.Names}} {{.Status}}'
    say "site"
    curl -s -o /dev/null -w '   home.aspiro.dev %{http_code}\n' --max-time 20 https://home.aspiro.dev/ || true
}

# Sourced by migrate_to_usb_ssd_test.sh for its functions; run only when executed.
# Executed as a file, or piped into `bash -s` (BASH_SOURCE empty): run. Sourced: don't.
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1:---check}" in
        --check) check ;;
        --apply) apply "${2:-}" ;;
        --verify) verify ;;
        *) die "usage: $0 [--check | --apply /dev/sdX | --verify]" ;;
    esac
fi
