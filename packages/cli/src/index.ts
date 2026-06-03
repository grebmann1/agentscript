#!/usr/bin/env node
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import path from 'node:path';
import { buildBundle } from './commands/build.js';

const VERSION = '0.1.0';

const USAGE = `agentscript — turn .agent files into a deployable bundle

Usage:
  agentscript build <input> [--out <dir>] [--name <bundle-name>]
  agentscript --help
  agentscript --version

Commands:
  build      Compile .agent file(s) and emit a Heroku-ready bundle.

Options:
  --out      Output directory (default: ./dist-agent).
  --name     Bundle name written into package.json (default: outDir basename).
  --help     Show this message.
  --version  Print CLI version.
`;

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  switch (command) {
    case 'build':
      return runBuild(rest);
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

async function runBuild(args: string[]): Promise<number> {
  const positional: string[] = [];
  let outDir: string | undefined;
  let bundleName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' || arg === '-o') {
      outDir = args[++i];
    } else if (arg === '--name' || arg === '-n') {
      bundleName = args[++i];
    } else if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
    } else if (arg.startsWith('--name=')) {
      bundleName = arg.slice('--name='.length);
    } else if (arg.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${arg}\n`);
      return 1;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    process.stderr.write(`build expects exactly one input path.\n\n${USAGE}`);
    return 1;
  }

  try {
    const result = await buildBundle({
      input: path.resolve(positional[0]),
      outDir: path.resolve(outDir ?? 'dist-agent'),
      bundleName,
    });
    process.stdout.write(
      `Built bundle at ${result.outDir}\n` +
        `  agents: ${result.agents.join(', ') || '(none)'}\n` +
        `  env vars: ${
          result.envRefs.length === 0
            ? '(none)'
            : result.envRefs.map(r => r.name).join(', ')
        }\n`
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/agentscript');
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      console.error(err);
      process.exit(1);
    }
  );
}
