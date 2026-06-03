#!/usr/bin/env bash
# Validate bin/detect against the fixture set.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DETECT="$BP_DIR/bin/detect"

fail=0

check_pass() {
  local fixture="$1"
  local out
  if ! out="$("$DETECT" "$SCRIPT_DIR/fixtures/$fixture" 2>&1)"; then
    echo "FAIL: detect $fixture exited non-zero"
    fail=1
    return
  fi
  if [ "$out" != "AgentScript" ]; then
    echo "FAIL: detect $fixture printed '$out', expected 'AgentScript'"
    fail=1
    return
  fi
  echo "ok   detect $fixture"
}

check_fail() {
  local label="$1" path="$2"
  if "$DETECT" "$path" >/dev/null 2>&1; then
    echo "FAIL: detect $label exited 0, expected 1"
    fail=1
    return
  fi
  echo "ok   detect $label (skipped, no .agent)"
}

check_pass single-agent
check_pass multi-agent
check_pass with-package

empty="$(mktemp -d)"
trap 'rm -rf "$empty"' EXIT
check_fail empty-dir "$empty"

if [ $fail -ne 0 ]; then
  exit 1
fi
echo "all detect tests passed"
