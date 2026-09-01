#!/bin/bash
# Bygger den statiske siden og pusher den til gh-pages-grenen.
#
# Klonen i .deploy-gh-pages beholdes mellom kjøringer, så git bare laster
# opp det som faktisk er endret — typisk noen hundre kB, ikke alle
# miniatyrene på nytt. Første kjøring laster ned grenen én gang.
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_DIR="${DEPLOY_DIR:-.deploy-gh-pages}"
REPO_URL="https://github.com/kvitberg/omradebilder.git"

NEXT_PUBLIC_BASE_PATH=/omradebilder npm run build

if [ ! -d "$DEPLOY_DIR/.git" ]; then
  git clone --depth 1 --branch gh-pages --single-branch "$REPO_URL" "$DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"
git fetch origin gh-pages
git reset --hard origin/gh-pages

# Speil bygget inn: slett filer som er borte, men la .git stå.
rsync -a --delete --exclude .git ../out/ .

git add -A
if git diff --cached --quiet; then
  echo "Ingenting å deploye — bygget er identisk med det som ligger ute."
  exit 0
fi

git commit -m "Deploy $(date '+%Y-%m-%d %H:%M')"
git push origin gh-pages
echo "Deployet. Siden oppdateres på https://kvitberg.github.io/omradebilder/ om et minutt eller to."
