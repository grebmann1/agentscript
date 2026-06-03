#!/usr/bin/env node
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cp, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'src/bundle/template');
const dest = resolve(root, 'dist/bundle/template');

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`copied bundle template → ${dest}`);
