/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cp, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ossRoot = resolve(here, '..');
const standaloneAppRoot = join(ossRoot, '.next/standalone/apps/oss');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureExists(p, what) {
  if (!(await exists(p))) {
    throw new Error(`[oss] missing ${what}: ${p}`);
  }
}

await ensureExists(standaloneAppRoot, 'standalone app root (run `next build` first)');

await cp(
  join(ossRoot, '.next/static'),
  join(standaloneAppRoot, '.next/static'),
  { recursive: true }
);
console.log('[oss] copied .next/static into standalone tree');

const publicSrc = join(ossRoot, 'public');
if (await exists(publicSrc)) {
  await cp(publicSrc, join(standaloneAppRoot, 'public'), { recursive: true });
  console.log('[oss] copied public/ into standalone tree');
}
