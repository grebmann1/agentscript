#!/usr/bin/env bash
# Deploy apps/demo/ to the agentscript-runner-demo Heroku app.
#
# This script is idempotent and re-runnable. It:
#   1. pnpm-packs the three workspace packages referenced by package.json
#      into vendor/ (overrides keys must match the tarball filename version,
#      so bump the package.json version BEFORE running this if you changed
#      source — npm caches file: deps by filename and a same-name push is
#      a silent no-op on the dyno).
#   2. Stages everything in a one-off worktree under .deploy/ so the
#      apps/demo/ tree itself stays clean (no vendor/, no .git noise).
#   3. Initializes (or reuses) a git repo in .deploy/ pointed at heroku and
#      force-pushes main to deploy.
#
# Heroku app: agentscript-runner-demo
# Live URL:   https://agentscript-runner-demo-43272b107f3c.herokuapp.com
#
# Usage:
#   ./apps/demo/scripts/deploy.sh
#
# Required env / state:
#   - heroku CLI authenticated (heroku auth:whoami)
#   - The MCP_AUTH_TOKENS config var must already be set on the Heroku app
#     (this script does not write secrets). Verify with:
#         heroku config:get MCP_AUTH_TOKENS -a agentscript-runner-demo

set -euo pipefail

HEROKU_APP="agentscript-runner-demo"
DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DEMO_DIR/../.." && pwd)"
WORK_DIR="$DEMO_DIR/.deploy"

echo "→ workspace: $REPO_ROOT"
echo "→ demo dir:  $DEMO_DIR"
echo "→ deploy at: $WORK_DIR"

# Packages whose tarballs feed into vendor/. The version in package.json's
# overrides must match each tarball name 1:1.
PACKAGES=(
  "$REPO_ROOT/dialect/agentfabric"
  "$REPO_ROOT/dialect/agentforce"
  "$REPO_ROOT/dialect/agentscript"
  "$REPO_ROOT/packages/agentforce"
  "$REPO_ROOT/packages/cli"
  "$REPO_ROOT/packages/compiler"
  "$REPO_ROOT/packages/language"
  "$REPO_ROOT/packages/parser"
  "$REPO_ROOT/packages/parser-javascript"
  "$REPO_ROOT/packages/parser-tree-sitter"
  "$REPO_ROOT/packages/runtime"
  "$REPO_ROOT/packages/runtime-vercel"
  "$REPO_ROOT/packages/server"
  "$REPO_ROOT/packages/types"
)

# 1) Build a fresh vendor/ directory from pnpm pack.
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/vendor"

for pkg in "${PACKAGES[@]}"; do
  echo "→ packing $(basename "$pkg")"
  (cd "$pkg" && pnpm pack --pack-destination "$WORK_DIR/vendor" >/dev/null)
done

# 2) Copy the manifest and agents into the working dir.
cp "$DEMO_DIR/Procfile" "$WORK_DIR/Procfile"
cp "$DEMO_DIR/package.json" "$WORK_DIR/package.json"
cp -r "$DEMO_DIR/agents" "$WORK_DIR/agents"

# Sanity-check: every override must point at a tarball that actually exists.
node -e "
  const fs = require('fs');
  const path = require('path');
  const pkg = JSON.parse(fs.readFileSync('$WORK_DIR/package.json', 'utf8'));
  const refs = Object.values(pkg.overrides ?? {});
  const missing = refs
    .filter(r => r.startsWith('file:'))
    .map(r => r.slice('file:'.length))
    .filter(p => !fs.existsSync(path.join('$WORK_DIR', p)));
  if (missing.length) {
    console.error('Missing tarballs referenced by overrides:');
    for (const m of missing) console.error('  - ' + m);
    console.error('Did you bump package.json versions before deploy?');
    process.exit(1);
  }
"

# 3) Push to Heroku from the working tree.
cd "$WORK_DIR"
git init -q -b main
git add -A
git -c user.email='deploy@agentscript' -c user.name='deploy' \
    -c commit.gpgsign=false \
    commit -q -m "deploy from apps/demo @ $(cd "$REPO_ROOT" && git rev-parse --short HEAD)"
git remote add heroku "https://git.heroku.com/$HEROKU_APP.git"

echo "→ pushing to heroku ($HEROKU_APP)…"
git push heroku main --force

echo "✓ deployed. live URL:"
echo "    https://agentscript-runner-demo-43272b107f3c.herokuapp.com"
