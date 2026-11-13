#!/usr/bin/env bash
# Run ON THE UNO Q. Fallback if App Lab ignores a symlink in ~/ArduinoApps.
# Usage: ~/repo/tools/deploy.sh   (then hit Run in App Lab)
set -euo pipefail
cd ~/repo
git pull --ff-only
rsync -a --delete --exclude '.cache/' ~/repo/unoq-app/ ~/ArduinoApps/junction-app/
echo "Deployed $(git rev-parse --short HEAD) to ~/ArduinoApps/junction-app"
