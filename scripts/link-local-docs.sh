#!/bin/sh
# Link this checkout's local-only working documents to the shared store.
#
# git worktrees only receive TRACKED files, so anything gitignored — the
# superpowers plans and specs above all — is absent from every new worktree. The
# store lives outside all of them and is symlinked in, so there is exactly one
# copy and a plan written on one branch is readable from every other.
#
# Safe to re-run: it only creates what is missing and never overwrites content.
#
#   scripts/link-local-docs.sh            link this checkout
#   scripts/link-local-docs.sh --check    report what it would do, change nothing
#
# Override the store location with FORESTGEO_LOCAL_STORE.

set -eu

STORE="${FORESTGEO_LOCAL_STORE:-$HOME/dev/ForestGEO-local}"
# Linked: one shared copy, so an edit is instantly true everywhere.
LINK_PATHS='docs/superpowers frontend/docs/superpowers CLAUDE.md frontend/CLAUDE.md'
# Copied: per-checkout files that tools rewrite in place, and secrets. One shared
# inode would let an edit made for one branch silently change every other.
COPY_PATHS='frontend/.env.local'

check_only=0
[ "${1:-}" = "--check" ] && check_only=1

root=$(git rev-parse --show-toplevel)
cd "$root"

if [ ! -d "$STORE" ]; then
  echo "link-local-docs: store not found at $STORE" >&2
  echo "  set FORESTGEO_LOCAL_STORE, or see $STORE/README.md for what belongs there." >&2
  exit 1
fi

status=0

for rel in $LINK_PATHS; do
  target="$STORE/$rel"
  link="$root/$rel"

  if [ ! -e "$target" ]; then
    echo "  skip   $rel (nothing at $target)"
    continue
  fi

  # A branch that still TRACKS these paths would see the symlink as a mass
  # deletion of every file under it. Refuse until the untracking commit is in.
  if [ -n "$(git ls-files -- "$rel")" ]; then
    echo "  SKIP   $rel — still tracked on this branch; link it after the untracking commit lands here"
    status=1
    continue
  fi

  if [ -L "$link" ]; then
    if [ "$(readlink "$link")" = "$target" ]; then
      echo "  ok     $rel"
    else
      echo "  WRONG  $rel -> $(readlink "$link") (expected $target); remove it and re-run"
      status=1
    fi
    continue
  fi

  if [ -e "$link" ]; then
    echo "  SKIP   $rel — a real file/directory is already there; move it into $target, delete it, and re-run"
    status=1
    continue
  fi

  if [ "$check_only" = 1 ]; then
    echo "  would  link $rel -> $target"
  else
    mkdir -p "$(dirname "$link")"
    ln -s "$target" "$link"
    echo "  link   $rel -> $target"
  fi
done

for rel in $COPY_PATHS; do
  source_file="$STORE/$rel"
  dest="$root/$rel"
  [ -f "$source_file" ] || continue
  if [ -e "$dest" ]; then
    echo "  ok     $rel (present)"
  elif [ "$check_only" = 1 ]; then
    echo "  would  copy $rel"
  else
    mkdir -p "$(dirname "$dest")"
    cp "$source_file" "$dest"
    echo "  copy   $rel"
  fi
done

exit $status
