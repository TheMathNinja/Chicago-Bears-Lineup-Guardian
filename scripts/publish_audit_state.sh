#!/usr/bin/env bash

set -euo pipefail

commit_message="${1:?commit message is required}"

git config user.name "adl-lineup-guardian[bot]"
git config user.email "actions@users.noreply.github.com"
git add data docs

if git diff --cached --quiet; then
  echo "No audit-state changes to publish."
  exit 0
fi

git commit -m "${commit_message}"

for ((attempt = 1; attempt <= 5; attempt++)); do
  echo "Audit publication attempt ${attempt} of 5."

  if ! git fetch origin main; then
    echo "GitHub fetch failed; retrying after a short delay."
    sleep $((attempt * 5))
    continue
  fi

  if ! git rebase origin/main; then
    git rebase --abort || true
    echo "::warning::A newer Guardian run published overlapping audit state first. The lineup check succeeded; this duplicate audit update was skipped."
    exit 0
  fi

  if git push origin HEAD:main; then
    echo "Guardian audit state published successfully."
    exit 0
  fi

  echo "GitHub rejected the audit push; retrying after a short delay."
  sleep $((attempt * 5))
done

echo "::warning::The lineup check succeeded, but GitHub remained unavailable for audit-state publication after 5 attempts."
exit 0
