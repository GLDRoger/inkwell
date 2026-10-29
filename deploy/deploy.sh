#!/usr/bin/env bash
set -euo pipefail

# Deploy a committed snapshot only. No remote git credentials or local secrets.
# The host alias must have root access (hostinger-hermes is provisioned that way).
host="${1:-hostinger-hermes}"
root="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
sha="$(git -C "$root" rev-parse HEAD)"
archive="$(mktemp "${TMPDIR:-/tmp}/inkwell-deploy.XXXXXXXX")"
trap 'rm -f "$archive"' EXIT
if git -C "$root" ls-tree -r --name-only "$sha" | rg '(^|/)\.env($|\.)' | rg -v '(^|/)\.env\.example$' >/dev/null; then
  echo 'Refusing to deploy a commit containing an env file.' >&2
  exit 1
fi
git -C "$root" archive --format=tar "$sha" > "$archive"
ssh "$host" "mkdir -p /opt/inkwell/src /opt/inkwell/data && chmod 750 /opt/inkwell/data && chown 1000:1000 /opt/inkwell/data"
scp -q "$archive" "$host:/opt/inkwell/source-$sha.tar"
ssh "$host" bash -s -- "$sha" <<'REMOTE'
set -euo pipefail
sha="$1"
exec 9>/opt/inkwell/deploy.lock
flock -n 9 || { echo 'An Inkwell deployment is already running.' >&2; exit 1; }
before="$(curl --max-time 20 -s -o /dev/null -w '%{http_code}' https://spaces.questili.com/api/health)"
echo "spaces_before=$before"
# Fresh extraction removes stale source without ever touching data or env.
staging="$(mktemp -d /opt/inkwell/src.XXXXXXXX)"
trap 'rm -rf "$staging"' EXIT
tar -xf "/opt/inkwell/source-$sha.tar" -C "$staging"
if [ ! -f /opt/inkwell/.env ]; then
  (umask 077; sed -E 's/^META_API_KEY=.*/META_API_KEY=/; s|^DATA_DIR=.*|DATA_DIR=/data|' "$staging/.env.example" > /opt/inkwell/.env
   printf '\nTRUST_PROXY=1\n' >> /opt/inkwell/.env)
fi
chmod 600 /opt/inkwell/.env
# Only /opt/inkwell/src is replaced. Never operate on another compose project.
rsync -a --delete "$staging/" /opt/inkwell/src/
cd /opt/inkwell/src
docker compose -p inkwell -f deploy/docker-compose.yml up -d --build --wait --wait-timeout 120
curl --fail --max-time 10 -s http://127.0.0.1:8790/api/health
printf '\n'
printf '%s\n' "$sha" > /opt/inkwell/deployed-commit
rm -f "/opt/inkwell/source-$sha.tar"
after="$(curl --max-time 20 -s -o /dev/null -w '%{http_code}' https://spaces.questili.com/api/health)"
echo "spaces_after=$after"
[ "$before" = "$after" ] || { echo 'Spaces health changed; investigate without modifying Spaces.' >&2; exit 1; }
echo "deployed_commit=$sha"
echo 'https://inkwell.76-13-246-244.sslip.io'
REMOTE
