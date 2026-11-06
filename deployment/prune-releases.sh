#!/usr/bin/env bash
set -euo pipefail

# Call under the deployment lock, once the current release is healthy.
root="$(realpath -e -- "${1:?Deployment root required}")"
rollback="${2-}"
releases="$root/releases"
[[ -d "$releases" && ! -L "$releases" && -L "$root/current" ]]
current="$(realpath -e -- "$root/current")"

is_release() {
  local path="$1" sha="${1##*/}"
  [[ "$sha" =~ ^[a-f0-9]{40}$ && "$path" == "$releases/$sha" && -d "$path" && ! -L "$path" ]]
}

is_complete() {
  is_release "$1" && [[ -f "$1/.release-sha" && "$(<"$1/.release-sha")" == "${1##*/}" ]]
}

if ! is_complete "$current" || { [[ -n "$rollback" ]] && { ! is_complete "$rollback" || [[ "$rollback" == "$current" ]]; }; }; then
  echo "Cannot verify the releases to retain. Cleanup skipped." >&2
  exit 1
fi

for path in "$releases"/*; do
  if is_release "$path" && [[ "$path" != "$current" && "$path" != "$rollback" ]]; then
    rm -rf --one-file-system -- "$path"
  fi
done
printf 'Retained current release %s\n' "${current##*/}"
if [[ -n "$rollback" ]]; then
  printf 'Retained rollback release %s\n' "${rollback##*/}"
fi
