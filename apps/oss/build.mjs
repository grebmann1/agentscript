/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { cp, mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, 'src');
const OUT = resolve(__dirname, 'dist');

const watch = process.argv.includes('--watch');

const ROBOTS = `User-agent: *
Allow: /
`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://agentscript.dev/</loc></url>
</urlset>
`;

async function build() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, { recursive: true });
  await writeFile(join(OUT, 'robots.txt'), ROBOTS);
  await writeFile(join(OUT, 'sitemap.xml'), SITEMAP);
  console.log(`[oss] built → ${OUT}`);
}

async function serve() {
  const PORT = Number(process.env.PORT) || 4321;
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8',
  };
  createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(OUT, p);
    if (!file.startsWith(OUT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const data = readFileSync(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      });
      res.end(data);
    } catch {
      try {
        const data = readFileSync(join(OUT, 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(data);
      } catch {
        res.writeHead(404).end('Not found');
      }
    }
  }).listen(PORT, () => {
    console.log(`[oss] dev server http://localhost:${PORT}`);
  });
}

async function watchTree(dir, onChange) {
  const { watch: fsWatch } = await import('node:fs');
  fsWatch(dir, { recursive: true }, () => onChange());
}

await build();
if (watch) {
  await serve();
  let timer = null;
  await watchTree(SRC, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      build().catch(err => console.error(err));
    }, 80);
  });
}
