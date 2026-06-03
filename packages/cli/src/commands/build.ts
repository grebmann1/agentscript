/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  walkEnvRefs,
  type AgentDSLAuthoringWithDeployment,
  type DeploymentConfig,
} from '@agentscript/compiler';
import { compileSource } from '@agentscript/runtime-vercel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BuildOptions {
  /** File or directory of `.agent` sources. */
  input: string;
  /** Output directory. Defaults to `<cwd>/dist-agent`. */
  outDir: string;
  /** Bundle name written into the generated package.json. */
  bundleName?: string;
  /** Override the template directory (used by tests). */
  templateDir?: string;
}

export interface BuildResult {
  outDir: string;
  agents: string[];
  envRefs: Array<{ name: string; path: string }>;
}

/**
 * Compile every `.agent` under `input` into a Heroku-deployable bundle.
 *
 * Layout produced under `outDir`:
 *   - package.json, Procfile, .gitignore, README.md (from template)
 *   - agents/<name>.agent          (raw source — server compiles at boot)
 *   - .env.example                 (every env(NAME) referenced by deployment)
 *   - agentscript.json             (manifest: agent ids + cli version)
 */
export async function buildBundle(options: BuildOptions): Promise<BuildResult> {
  const sources = await collectSources(options.input);
  if (sources.length === 0) {
    throw new Error(`No .agent files found at ${options.input}`);
  }

  const compiled = sources.map(s => ({
    file: s.file,
    name: s.name,
    source: s.source,
    deployment: extractDeployment(s.file, s.source),
  }));

  await mkdir(options.outDir, { recursive: true });
  await copyTemplate(
    options.templateDir ?? defaultTemplateDir(),
    options.outDir,
    options.bundleName ?? path.basename(path.resolve(options.outDir))
  );

  const agentsDir = path.join(options.outDir, 'agents');
  await mkdir(agentsDir, { recursive: true });
  for (const agent of compiled) {
    await writeFile(
      path.join(agentsDir, `${agent.name}.agent`),
      agent.source,
      'utf8'
    );
  }

  const envRefs = collectEnvRefs(compiled.map(c => c.deployment));
  await writeFile(
    path.join(options.outDir, '.env.example'),
    renderEnvExample(envRefs),
    'utf8'
  );

  await writeFile(
    path.join(options.outDir, 'agentscript.json'),
    JSON.stringify(
      {
        agents: compiled.map(c => c.name).sort(),
        envVars: envRefs.map(r => r.name),
        generator: '@agentscript/cli',
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  return {
    outDir: options.outDir,
    agents: compiled.map(c => c.name).sort(),
    envRefs,
  };
}

interface SourceEntry {
  file: string;
  name: string;
  source: string;
}

async function collectSources(input: string): Promise<SourceEntry[]> {
  const stats = await stat(input).catch(() => null);
  if (!stats) {
    throw new Error(`Input path does not exist: ${input}`);
  }
  if (stats.isFile()) {
    if (!input.endsWith('.agent')) {
      throw new Error(`Expected a .agent file, got: ${input}`);
    }
    return [
      {
        file: input,
        name: path.basename(input, '.agent'),
        source: await readFile(input, 'utf8'),
      },
    ];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Input is neither a file nor a directory: ${input}`);
  }

  const out: SourceEntry[] = [];
  const queue = [input];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.agent')) {
        out.push({
          file: fullPath,
          name: path.basename(fullPath, '.agent'),
          source: await readFile(fullPath, 'utf8'),
        });
      }
    }
  }
  return out;
}

function extractDeployment(
  file: string,
  source: string
): DeploymentConfig | undefined {
  const result = compileSource(source);
  const hardErrors = result.diagnostics.filter(
    diagnostic =>
      diagnostic.severity === 1 && diagnostic.code !== 'invalid-action-target'
  );
  if (hardErrors.length > 0) {
    const messages = hardErrors.map(e => e.message).join('; ');
    throw new Error(`Failed to compile ${file}: ${messages}`);
  }
  return (result.output as AgentDSLAuthoringWithDeployment).deployment;
}

async function copyTemplate(
  templateDir: string,
  outDir: string,
  bundleName: string
): Promise<void> {
  await cp(templateDir, outDir, { recursive: true });
  const pkgPath = path.join(outDir, 'package.json');
  const pkgRaw = await readFile(pkgPath, 'utf8');
  await writeFile(
    pkgPath,
    pkgRaw.replace(/__AGENT_BUNDLE_NAME__/g, sanitizeBundleName(bundleName)),
    'utf8'
  );
}

function sanitizeBundleName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'agent-bundle';
}

function defaultTemplateDir(): string {
  // dist/commands/build.js → dist/bundle/template (production)
  // src/commands/build.ts  → src/bundle/template  (workspace dev)
  return path.resolve(__dirname, '..', 'bundle', 'template');
}

function collectEnvRefs(
  deployments: Array<DeploymentConfig | undefined>
): Array<{ name: string; path: string }> {
  const seen = new Map<string, string>();
  for (const deployment of deployments) {
    if (!deployment) continue;
    for (const ref of walkEnvRefs(deployment)) {
      if (!seen.has(ref.name)) seen.set(ref.name, ref.path);
    }
  }
  return [...seen.entries()]
    .map(([name, p]) => ({ name, path: p }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderEnvExample(refs: Array<{ name: string; path: string }>): string {
  if (refs.length === 0) {
    return '# No environment variables required by this bundle.\n';
  }
  const lines = ['# Generated by @agentscript/cli — fill in before deploying.'];
  for (const ref of refs) {
    lines.push(`# ${ref.path}`);
    lines.push(`${ref.name}=`);
  }
  return lines.join('\n') + '\n';
}
