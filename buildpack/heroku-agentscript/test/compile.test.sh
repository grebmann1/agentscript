#!/usr/bin/env bash
# Validate bin/compile against fixtures using the workspace CLI in place of
# a globally-installed @agentscript/cli.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BP_DIR/../.." && pwd)"
COMPILE="$BP_DIR/bin/compile"

CLI_BIN="$REPO_ROOT/packages/cli/dist/index.js"
if [ ! -f "$CLI_BIN" ]; then
  echo "FAIL: $CLI_BIN missing — run 'pnpm --filter @agentscript/cli build' first"
  exit 1
fi

# Build a thin wrapper so the buildpack invokes node directly, avoiding the
# need to install the CLI globally inside the test environment.
WRAP_DIR="$(mktemp -d)"
trap 'rm -rf "$WRAP_DIR"' EXIT
WRAP="$WRAP_DIR/agentscript"
cat > "$WRAP" <<EOF
#!/usr/bin/env bash
exec node "$CLI_BIN" "\$@"
EOF
chmod +x "$WRAP"

run_compile() {
  local fixture="$1" build_dir
  build_dir="$(mktemp -d)"
  cp -R "$SCRIPT_DIR/fixtures/$fixture/." "$build_dir/"
  local cache_dir env_dir
  cache_dir="$(mktemp -d)"
  env_dir="$(mktemp -d)"
  AGENTSCRIPT_CLI_BIN="$WRAP" \
    "$COMPILE" "$build_dir" "$cache_dir" "$env_dir" >/dev/null
  echo "$build_dir"
}

fail=0

assert_file() {
  local path="$1" label="$2"
  if [ ! -f "$path" ]; then
    echo "FAIL: $label missing ($path)"
    fail=1
  fi
}

assert_contains() {
  local path="$1" needle="$2" label="$3"
  if ! grep -qF "$needle" "$path"; then
    echo "FAIL: $label expected to contain '$needle'"
    fail=1
  fi
}

# 1) single .agent at root
out="$(run_compile single-agent)"
assert_file       "$out/package.json"      "single-agent package.json"
assert_file       "$out/Procfile"          "single-agent Procfile"
assert_file       "$out/agents/support.agent" "single-agent agents/support.agent"
assert_file       "$out/.env.example"      "single-agent .env.example"
assert_file       "$out/agentscript.json"  "single-agent agentscript.json"
assert_contains   "$out/.env.example"      "ANTHROPIC_API_KEY=" "single-agent env var"
assert_contains   "$out/Procfile"          "node_modules/@agentscript/server/dist/index.js" "single-agent Procfile cmd"
echo "ok   compile single-agent"
rm -rf "$out"

# 2) agents/ directory of multiple .agent files
out="$(run_compile multi-agent)"
assert_file "$out/agents/support.agent" "multi-agent support"
assert_file "$out/agents/billing.agent" "multi-agent billing"
assert_contains "$out/agentscript.json" '"billing"' "multi-agent manifest"
assert_contains "$out/agentscript.json" '"support"' "multi-agent manifest"
echo "ok   compile multi-agent"
rm -rf "$out"

# 3) user-committed package.json must not be overwritten
out="$(run_compile with-package)"
assert_contains "$out/package.json" '"name": "user-owned"' "with-package preserved"
assert_contains "$out/package.json" '"version": "9.9.9"'  "with-package preserved version"
echo "ok   compile with-package preserves user package.json"
rm -rf "$out"

if [ $fail -ne 0 ]; then
  exit 1
fi
echo "all compile tests passed"
