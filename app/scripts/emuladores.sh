#!/usr/bin/env bash
# Start the Firebase emulators for local work (demo project: nothing in Google Cloud is touched).
# Needs Java 11+ (brew install openjdk@21). On macOS, no_proxy=* stops Python from querying the
# system proxy settings before the functions server forks, which otherwise crashes the worker.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d /opt/homebrew/opt/openjdk@21/bin ]; then export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"; fi
export no_proxy='*' NO_PROXY='*'
# The first start compiles bytecode and can exceed the CLI's 10 s discovery timeout.
export FUNCTIONS_DISCOVERY_TIMEOUT=60
bash scripts/sync-nucleo.sh
exec firebase emulators:start --project demo-spi-invimagil "$@"
