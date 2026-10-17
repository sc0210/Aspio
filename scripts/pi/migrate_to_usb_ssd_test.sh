#!/usr/bin/env bash
# Tests for the one step of migrate_to_usb_ssd.sh that decides whether the SSD
# boots at all: rewriting cmdline.txt and fstab to the SSD's PARTUUIDs.
set -uo pipefail
# shellcheck source=migrate_to_usb_ssd.sh
source "$(dirname "$0")/migrate_to_usb_ssd.sh"
set +e
fail=0
tmp=$(mktemp -d)  # fixtures only; the OS clears its temp dir

fixture() {
    printf 'console=serial0,115200 console=tty1 root=%s rootfstype=ext4 fsck.repair=yes rootwait quiet splash\n' "$1" > "$tmp/cmdline.txt"
    printf 'proc            /proc           proc    defaults          0       0\nPARTUUID=ece4ce20-01  /boot/firmware  vfat    defaults          0       2\nPARTUUID=ece4ce20-02  /               ext4    defaults,noatime  0       1\n' > "$tmp/fstab"
}
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

# The Pi as it is today.
fixture "PARTUUID=ece4ce20-02"
repoint_partuuids "$tmp/cmdline.txt" "$tmp/fstab" ece4ce20-01 ece4ce20-02 5a3b9c1d-01 5a3b9c1d-02
rc=$?
check "rewrite succeeds" '[ $rc -eq 0 ]'
check "cmdline names the SSD root" 'grep -q "root=PARTUUID=5a3b9c1d-02 " "$tmp/cmdline.txt"'
check "fstab names the SSD root" 'grep -q "^PARTUUID=5a3b9c1d-02 " "$tmp/fstab"'
check "fstab names the SSD boot" 'grep -q "^PARTUUID=5a3b9c1d-01 " "$tmp/fstab"'
check "no SD PARTUUID left" '! grep -q "ece4ce20" "$tmp/cmdline.txt" "$tmp/fstab"'
check "other cmdline options kept" 'grep -q "rootwait quiet splash" "$tmp/cmdline.txt"'

# A tab-separated fstab is just as valid.
fixture "PARTUUID=ece4ce20-02"
printf 'PARTUUID=ece4ce20-01\t/boot/firmware\tvfat\tdefaults\t0\t2\nPARTUUID=ece4ce20-02\t/\text4\tdefaults,noatime\t0\t1\n' > "$tmp/fstab"
repoint_partuuids "$tmp/cmdline.txt" "$tmp/fstab" ece4ce20-01 ece4ce20-02 5a3b9c1d-01 5a3b9c1d-02
rc=$?
check "tab-separated fstab is accepted" '[ $rc -eq 0 ]'

# Root named by device path: must refuse, not leave an SSD that boots the SD root.
fixture "/dev/mmcblk0p2"
repoint_partuuids "$tmp/cmdline.txt" "$tmp/fstab" ece4ce20-01 ece4ce20-02 5a3b9c1d-01 5a3b9c1d-02
rc=$?
check "device-path root is refused" '[ $rc -ne 0 ]'

exit $fail
