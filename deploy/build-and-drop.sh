#!/bin/bash
# Build the Alexandria image on the build VM and drop it on node2 (2026-11-17), instead of building on node2.
#   ~/searxng/deploy/build-and-drop.sh
# Uses build-image.sh (git pull + build alexandria:<sha> + alexandria:latest), then docker save | gzip and an
# SFTP upload (no waiting) as user claude-images (ssh host "node2-images" in ~/.ssh/config: SFTP only, chrooted to
# /srv/claude-images).  On node2 the claude-images.path unit docker-loads it (alexandria:* tags only, anything
# else is moved to /srv/claude-images-rejected) and deletes the tarball.
# Then in Portainer: Stacks > alexandria > Pull and redeploy (pull_policy: never uses the loaded image).
set -euo pipefail
cd "$(dirname "$0")/.."
./deploy/build-image.sh
SHA=$(git rev-parse --short HEAD)
FILE="alexandria-$SHA.tar.gz"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Saving alexandria:$SHA + alexandria:latest"
docker save "alexandria:$SHA" alexandria:latest | gzip -1 > "$TMP/$FILE"
du -h "$TMP/$FILE" | cut -f1

# upload as .part, then rename: the loader only picks up finished *.tar.gz files
echo "Uploading to node2"
sftp -b - node2-images <<EOF
put $TMP/$FILE $FILE.part
rename $FILE.part $FILE
EOF

# done: node2's claude-images.path unit loads it in the background (journalctl -t claude-images on node2)
echo "Uploaded $FILE. node2 loads it on its own; then Portainer > Stacks > alexandria > Pull and redeploy"
