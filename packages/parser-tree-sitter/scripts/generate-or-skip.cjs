#!/usr/bin/env node

/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

// `tree-sitter generate` regenerates src/parser.c from grammar.js, but parser.c
// is checked into git. Hosts that don't ship the tree-sitter CLI (Heroku
// dynos, CI without rust toolchain) would otherwise fail the workspace build.
// Skip generation when parser.c is already present and the CLI is not on PATH.

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const parserPath = path.join(__dirname, '..', 'src', 'parser.c');
const hasCli = spawnSync('tree-sitter', ['--version'], { stdio: 'ignore' }).status === 0;

if (hasCli) {
  execFileSync('tree-sitter', ['generate'], { stdio: 'inherit' });
  process.exit(0);
}

if (fs.existsSync(parserPath)) {
  console.log('tree-sitter CLI not found — using checked-in src/parser.c');
  process.exit(0);
}

console.error(
  'tree-sitter CLI not found and src/parser.c missing. Install tree-sitter-cli or check in src/parser.c.'
);
process.exit(1);
