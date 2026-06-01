/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * `env(NAME)` references in the `deployment:` block. The compiler records the
 * env-var name in the IR but never reads its value at compile time, keeping
 * secrets out of the compiled JSON. The runtime resolves these at boot.
 */
export interface EnvRef {
  kind: 'env';
  name: string;
  prefix?: string;
  default?: string;
}

export type DeploymentValue = EnvRef | string;

const ENV_CALL = /^env\s*\(\s*([A-Z][A-Z0-9_]*)\s*(?:,\s*(.*?))?\s*\)$/;
const KW_ARG = /(prefix|default)\s*=\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * Parse a raw string. Returns an EnvRef when the string is `env(...)`,
 * otherwise returns the string unchanged.
 */
export function parseDeploymentValue(raw: string): DeploymentValue {
  const trimmed = raw.trim();
  const match = trimmed.match(ENV_CALL);
  if (!match) return raw;
  const name = match[1];
  const opts = match[2] ?? '';
  const ref: EnvRef = { kind: 'env', name };
  for (const m of opts.matchAll(KW_ARG)) {
    if (m[1] === 'prefix') ref.prefix = unescape(m[2]);
    else if (m[1] === 'default') ref.default = unescape(m[2]);
  }
  return ref;
}

function unescape(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Field names whose value should be a secret. Used by lint to flag literal
 * values and by the compiler to emit warnings.
 */
export const SECRET_FIELD_PATTERNS = [
  /api_key$/i,
  /_token$/i,
  /^token$/i,
  /_secret$/i,
  /^secret$/i,
  /password$/i,
];

export function isSecretField(name: string): boolean {
  return SECRET_FIELD_PATTERNS.some(p => p.test(name));
}
