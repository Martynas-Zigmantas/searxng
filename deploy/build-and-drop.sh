#!/bin/bash
# Build the Alexandria image on the build VM and drop it on node2 (2026-11-17), instead of building on node2.
#   ~/searxng/deploy/build-and-drop.sh          (Claude: start it in the background and move on; the pings report)
# Uses build-image.sh (git pull + build alexandria:<sha> + alexandria:latest), then docker save | gzip and an
# SFTP upload (no waiting) as user claude-images (ssh host "node2-images" in ~/.ssh/config: SFTP only, chrooted to
# /srv/claude-images).  On node2 the claude-images.path unit docker-loads it (alexandria:* tags only, anything
# else is moved to /srv/claude-images-rejected) and deletes the tarball.
# Then in Portainer: Stacks > alexandria > Pull and redeploy (pull_policy: never uses the loaded image).
# Telegram pings (🔨 started, ⏳ on node2 / waiting for the redeploy, ❌ failed) go to Martynas's PRIVATE chat
# through the same n8n webhook as the Epistle builds (~/.epistle-telegram), never the team bot.  Output -> a log
# in ~/alexandria-builds/logs, so whoever started it doesn't have to sit on it (run it in the background).
set -euo pipefail
cd "$(dirname "$0")/.."

TELEGRAM_ENV="${EPISTLE_TELEGRAM:-$HOME/.epistle-telegram}"
if [ -z "${BUILT_BY:-}" ]; then
  if [ "${CLAUDECODE:-}" = "1" ]; then BUILT_BY="Claude"; else BUILT_BY="${USER:-$(id -un)} by hand"; fi
fi
notify() {
  [ -f "$TELEGRAM_ENV" ] || return 0
  local url secret
  url=$(sed -n 's/^EPISTLE_PING_URL=//p' "$TELEGRAM_ENV" | tr -d '[:space:]"'"'" || true)
  secret=$(sed -n 's/^EPISTLE_PING_SECRET=//p' "$TELEGRAM_ENV" | tr -d '[:space:]"'"'" || true)
  { [ -n "$url" ] && [ -n "$secret" ]; } || return 0
  python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}, ensure_ascii=False))' "$1" \
    | curl -fsS --max-time 10 -X POST -H "X-Epistle-Ping: $secret" -H "Content-Type: application/json" \
      --data-binary @- "$url" >/dev/null 2>&1 \
    || echo "telegram ping failed (build unaffected)" >&2
  return 0
}

LOG_DIR="$HOME/alexandria-builds/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
START=$(date +%s)
# shellcheck disable=SC2154  # code is set inside the trap
trap 'code=$?; notify "❌ Alexandria image build by $BUILT_BY failed on $(hostname) after $(( ($(date +%s) - START) / 60 ))m (exit $code). Log: $LOG"; exit $code' ERR

notify "🔨 Alexandria image build started by $BUILT_BY on $(hostname) ($(git log -1 --format='%h %s'))."
./deploy/build-image.sh
SHA=$(git rev-parse --short HEAD)
FILE="alexandria-$SHA.tar.gz"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Saving alexandria:$SHA + alexandria:latest"
docker save "alexandria:$SHA" alexandria:latest | gzip -1 > "$TMP/$FILE"
SIZE=$(du -h "$TMP/$FILE" | cut -f1)
echo "  $SIZE"

# upload as .part, then rename: the loader only picks up finished *.tar.gz files
echo "Uploading to node2"
sftp -b - node2-images <<EOF
put $TMP/$FILE $FILE.part
rename $FILE.part $FILE
EOF

# done: node2's claude-images.path unit loads it in the background (journalctl -t claude-images on node2)
echo "Uploaded $FILE. node2 loads it on its own; then Portainer > Stacks > alexandria > Pull and redeploy"
notify "⏳ Alexandria image alexandria:$SHA built by $BUILT_BY on $(hostname) in $(( ($(date +%s) - START) / 60 ))m ($SIZE) and dropped on node2, waiting for Martynas:
Portainer > Stacks > alexandria > Pull and redeploy"
