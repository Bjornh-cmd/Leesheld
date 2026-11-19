#!/usr/bin/env bash
set -euo pipefail
command -v gh >/dev/null || { echo 'Installeer GitHub CLI: https://cli.github.com/'; exit 1; }
command -v git >/dev/null || { echo 'Installeer Git: https://git-scm.com/'; exit 1; }
gh auth status
[ -d .git ] || git init
git add .
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git -c user.name='Leesheld setup' -c user.email='leesheld@users.noreply.github.com' commit -m 'Initial Leesheld app'
elif ! git diff --cached --quiet; then
  git -c user.name='Leesheld setup' -c user.email='leesheld@users.noreply.github.com' commit -m 'Update Leesheld app'
fi
if existing_repo=$(gh repo view leesheld --json nameWithOwner --jq .nameWithOwner 2>/dev/null) && [ -n "$existing_repo" ]; then
  git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "https://github.com/${existing_repo}.git" || git remote add origin "https://github.com/${existing_repo}.git"
  git branch -M main
  git push -u origin main
else
  gh repo create leesheld --private --source . --remote origin --push
fi
echo 'Gereed! De Leesheld-code staat in je privérepository:'
gh repo view --json url --jq .url
echo 'Open nu Coolify en importeer deze repository als Docker Compose.'
