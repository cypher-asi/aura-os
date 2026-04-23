#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <pages-dir> <commit-message> [path ...]" >&2
  exit 2
fi

pages_dir="$1"
shift
commit_message="$1"
shift
allow_empty="${GH_PAGES_ALLOW_EMPTY:-0}"
allow_empty_normalized="$(printf '%s' "$allow_empty" | tr '[:upper:]' '[:lower:]')"

case "$allow_empty_normalized" in
  1|true|yes|on)
    allow_empty=1
    ;;
  *)
    allow_empty=0
    ;;
esac

cd "$pages_dir"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

for path in "$@"; do
  if [[ -e "$path" ]]; then
    git add "$path"
  else
    echo "Skipping missing gh-pages path: $path"
  fi
done

if git diff --cached --quiet; then
  if [[ "$allow_empty" != "1" ]]; then
    echo "No gh-pages changes to push."
    exit 0
  fi

  echo "No staged gh-pages changes; creating allow-empty commit to republish."
  git commit --allow-empty -m "$commit_message"
else
  git commit -m "$commit_message"
fi

for attempt in 1 2 3; do
  if git push; then
    exit 0
  fi

  if [[ "$attempt" == "3" ]]; then
    echo "Failed to push gh-pages after $attempt attempts." >&2
    exit 1
  fi

  echo "gh-pages moved while publishing; rebasing and retrying push (attempt $((attempt + 1))/3)."
  git fetch origin gh-pages
  if ! git rebase origin/gh-pages; then
    echo "Could not rebase generated gh-pages changes onto the latest remote branch." >&2
    git status --short
    exit 1
  fi
done
