#!/bin/bash
# Build the Alexandria image on node2 (Portainer can't build). Run from anywhere:
#   ~/searxng/deploy/build-image.sh        -> alexandria:latest + alexandria:<short sha>
# Then in Portainer: Stacks > alexandria > Update the stack (image is local, pull_policy: never).
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
SHA=$(git rev-parse --short HEAD)

# searx/version_frozen.py is what the image reports as its version + source link.
# Same format as `python -m searx.version freeze`, without needing Python deps here.
VERSION=$(git show -s --date='format:%Y.%m.%d' --format='%cd+%h' | sed 's/\.0/./g')
cat > searx/version_frozen.py <<PY
# pylint: disable=missing-module-docstring
# this file is generated automatically by deploy/build-image.sh

VERSION_STRING = "$VERSION"
VERSION_TAG = "$VERSION"
DOCKER_TAG = "${VERSION/+/-}"
GIT_URL = "https://github.com/Martynas-Zigmantas/searxng"  # footer "Source code" = the public GitHub mirror of this repo
GIT_BRANCH = "master"
PY

echo "Building alexandria:$SHA (~3-5 min)"
docker build -f container/Dockerfile \
  --build-arg CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg VERSION="${VERSION/+/-}" \
  --build-arg VCS_URL="https://git.jack-sally.com/Martynas-Cloud/searxng" \
  --build-arg VCS_REVISION="$(git rev-parse HEAD)" \
  -t "alexandria:$SHA" -t alexandria:latest .
echo "Built alexandria:$SHA and alexandria:latest"
docker image ls alexandria --format '{{.Repository}}:{{.Tag}}  {{.Size}}  {{.CreatedSince}}' | head -5
