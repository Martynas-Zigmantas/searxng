#!/bin/bash
# Build the Alexandria image on the build VM and drop it on node2: now one script for every server image,
# ~/epistle-infra/build-image.sh (alexandria | api | webmail), with private Telegram pings and a log in
# ~/epistle-builds/logs.  Kept so the old command still works.
exec "$HOME/epistle-infra/build-image.sh" alexandria "$@"
