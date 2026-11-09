#!/bin/sh
set -eu

# Core owns bind-mounted data. Adopt that uid:gid instead of changing its ownership.
# Root is used only to prepare a fresh volume and then immediately drops privileges.
if [ "$(id -u)" -ne 0 ]; then
    exec "$@"
fi
data_dir="${HOSTY_APP_DATA_DIR:-/app/data}"
mkdir -p "$data_dir"
owner="$(stat -c '%u:%g' "$data_dir")"
case "$owner" in
    0:*) chown node:node "$data_dir"; owner="node:node" ;;
esac
# Older development containers may have created these app-owned SQLite files as root.
# Repair only those files, preserving all other content and the mount's owner.
for name in trading.sqlite trading.sqlite-wal trading.sqlite-shm; do
    file="$data_dir/$name"
    if [ -f "$file" ] && [ ! -L "$file" ] && [ "$(stat -c '%u' "$file")" -eq 0 ]; then
        chown "$owner" "$file"
    fi
done
exec gosu "$owner" "$@"
