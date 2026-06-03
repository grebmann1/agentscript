/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBundle } from '../src/commands/build.js';

const agentWithDeployment = `
config:
    agent_name: "TestBot"

deployment:
    llm:
        provider: "anthropic"
        model: "claude-opus-4-5"
        api_key: "env(ANTHROPIC_API_KEY)"
    mcp:
        github:
            transport: "http"
            url: "env(GH_MCP_URL)"
            auth:
                strategy: "api_key"
                key: "env(GH_MCP_TOKEN)"

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            | hello
`;

const agentNoDeployment = `
config:
    agent_name: "PlainBot"

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            | hello
`;

describe('buildBundle', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(path.join(tmpdir(), 'agentscript-cli-'));
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(workdir, { recursive: true, force: true });
  });

  it('emits expected layout for a single .agent input', async () => {
    const inputDir = path.join(workdir, 'in');
    const outDir = path.join(workdir, 'out');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(inputDir, { recursive: true });
    await writeFile(
      path.join(inputDir, 'support.agent'),
      agentWithDeployment,
      'utf8'
    );

    const result = await buildBundle({
      input: path.join(inputDir, 'support.agent'),
      outDir,
    });

    expect(result.agents).toEqual(['support']);

    const files = await readdir(outDir);
    expect(files.sort()).toEqual(
      [
        '.env.example',
        '.gitignore',
        'Procfile',
        'README.md',
        'agents',
        'agentscript.json',
        'package.json',
      ].sort()
    );

    const agentsListing = await readdir(path.join(outDir, 'agents'));
    expect(agentsListing).toEqual(['support.agent']);

    const env = await readFile(path.join(outDir, '.env.example'), 'utf8');
    expect(env).toContain('ANTHROPIC_API_KEY=');
    expect(env).toContain('GH_MCP_URL=');
    expect(env).toContain('GH_MCP_TOKEN=');
    expect(env).toContain('# deployment.llm.api_key');

    const manifest = JSON.parse(
      await readFile(path.join(outDir, 'agentscript.json'), 'utf8')
    ) as { agents: string[]; envVars: string[]; generator: string };
    expect(manifest.agents).toEqual(['support']);
    expect(manifest.envVars.sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'GH_MCP_TOKEN',
      'GH_MCP_URL',
    ]);
    expect(manifest.generator).toBe('@agentscript/cli');
  });

  it('substitutes the bundle name into the template package.json', async () => {
    const inputDir = path.join(workdir, 'in');
    const outDir = path.join(workdir, 'my-bundle');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(inputDir, { recursive: true });
    await writeFile(path.join(inputDir, 'a.agent'), agentNoDeployment, 'utf8');

    await buildBundle({
      input: inputDir,
      outDir,
      bundleName: 'My Cool Bundle!',
    });

    const pkg = JSON.parse(
      await readFile(path.join(outDir, 'package.json'), 'utf8')
    ) as { name: string };
    expect(pkg.name).toBe('my-cool-bundle');
  });

  it('walks a directory of .agent files and unions env refs', async () => {
    const inputDir = path.join(workdir, 'agents');
    const outDir = path.join(workdir, 'out');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(inputDir, { recursive: true });
    await writeFile(
      path.join(inputDir, 'support.agent'),
      agentWithDeployment,
      'utf8'
    );
    await writeFile(
      path.join(inputDir, 'plain.agent'),
      agentNoDeployment,
      'utf8'
    );

    const result = await buildBundle({ input: inputDir, outDir });

    expect(result.agents.sort()).toEqual(['plain', 'support']);
    const env = await readFile(path.join(outDir, '.env.example'), 'utf8');
    expect(env).toContain('ANTHROPIC_API_KEY=');
  });

  it('writes a "no env vars required" comment when none are referenced', async () => {
    const inputDir = path.join(workdir, 'in');
    const outDir = path.join(workdir, 'out');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(inputDir, { recursive: true });
    await writeFile(
      path.join(inputDir, 'plain.agent'),
      agentNoDeployment,
      'utf8'
    );

    await buildBundle({ input: inputDir, outDir });

    const env = await readFile(path.join(outDir, '.env.example'), 'utf8');
    expect(env).toContain('No environment variables required');
  });

  it('fails clearly when the input path does not exist', async () => {
    await expect(
      buildBundle({
        input: path.join(workdir, 'nope.agent'),
        outDir: path.join(workdir, 'out'),
      })
    ).rejects.toThrow(/does not exist/);
  });

  it('fails clearly when no .agent files are found', async () => {
    const inputDir = path.join(workdir, 'empty');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(inputDir, { recursive: true });

    await expect(
      buildBundle({ input: inputDir, outDir: path.join(workdir, 'out') })
    ).rejects.toThrow(/No .agent files/);
  });

  it('rejects non-.agent files', async () => {
    const file = path.join(workdir, 'wrong.txt');
    await writeFile(file, 'irrelevant', 'utf8');
    await expect(
      buildBundle({ input: file, outDir: path.join(workdir, 'out') })
    ).rejects.toThrow(/Expected a .agent file/);
  });
});
