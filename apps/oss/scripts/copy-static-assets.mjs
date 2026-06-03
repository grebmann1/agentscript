/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const src = join(repoRoot, 'packages/server/agents/mcp_demo.agent');
const dest = join(here, '..', 'public/assets/agents/mcp_demo.agent');

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest);
console.log(`[oss] copied ${src} -> ${dest}`);
