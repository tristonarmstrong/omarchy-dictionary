#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node lint.test.js
node model.test.js
node lookup.test.js
