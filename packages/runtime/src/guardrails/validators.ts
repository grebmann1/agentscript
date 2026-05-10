/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Guardrail,
  GuardrailInput,
  GuardrailContext,
  GuardrailResult,
  GuardrailTarget,
} from './types.js';
import { validateSchema } from './schema-validator.js';

// ---------------------------------------------------------------------------
// jsonSchemaGuardrail
// ---------------------------------------------------------------------------

export function jsonSchemaGuardrail(opts: {
  schema: Record<string, unknown>;
  name?: string;
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail {
  return {
    name: opts.name ?? 'json-schema',
    target: 'text',
    maxRetries: opts.maxRetries ?? 2,
    feedbackTemplate: opts.feedbackTemplate,
    validate(output) {
      try {
        const parsed = JSON.parse(output.text);
        const errors = validateSchema(parsed, opts.schema, '');
        if (errors.length === 0) return { valid: true };
        return {
          valid: false,
          reason: 'JSON Schema validation failed',
          errors,
        };
      } catch (e) {
        return {
          valid: false,
          reason: `Invalid JSON: ${(e as Error).message}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// regexGuardrail
// ---------------------------------------------------------------------------

export function regexGuardrail(opts: {
  pattern: RegExp;
  invert?: boolean;
  name?: string;
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail {
  return {
    name: opts.name ?? `regex:${opts.pattern.source}`,
    target: 'text',
    maxRetries: opts.maxRetries ?? 1,
    feedbackTemplate: opts.feedbackTemplate,
    validate(output) {
      opts.pattern.lastIndex = 0;
      const matches = opts.pattern.test(output.text);
      const valid = opts.invert ? !matches : matches;
      return {
        valid,
        reason: valid
          ? undefined
          : opts.invert
            ? `Output must NOT match pattern: ${opts.pattern.source}`
            : `Output must match pattern: ${opts.pattern.source}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// contentPolicyGuardrail
// ---------------------------------------------------------------------------

export function contentPolicyGuardrail(opts: {
  blocklist?: Array<string | RegExp>;
  requirelist?: Array<string | RegExp>;
  name?: string;
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail {
  return {
    name: opts.name ?? 'content-policy',
    target: 'text',
    maxRetries: opts.maxRetries ?? 2,
    feedbackTemplate: opts.feedbackTemplate,
    validate(output) {
      for (const blocked of opts.blocklist ?? []) {
        const pattern =
          typeof blocked === 'string' ? new RegExp(blocked, 'i') : blocked;
        pattern.lastIndex = 0;
        if (pattern.test(output.text)) {
          return {
            valid: false,
            reason: `Blocked content detected: ${pattern.source}`,
          };
        }
      }
      for (const required of opts.requirelist ?? []) {
        const pattern =
          typeof required === 'string' ? new RegExp(required, 'i') : required;
        pattern.lastIndex = 0;
        if (!pattern.test(output.text)) {
          return {
            valid: false,
            reason: `Required content missing: ${pattern.source}`,
          };
        }
      }
      return { valid: true };
    },
  };
}

// ---------------------------------------------------------------------------
// customGuardrail
// ---------------------------------------------------------------------------

export function customGuardrail(
  name: string,
  fn: (
    output: GuardrailInput,
    ctx: GuardrailContext
  ) => GuardrailResult | Promise<GuardrailResult>,
  opts?: { maxRetries?: number; target?: GuardrailTarget }
): Guardrail;
export function customGuardrail(opts: {
  name: string;
  target?: GuardrailTarget;
  maxRetries?: number;
  feedbackTemplate?: string;
  validate: (
    output: GuardrailInput,
    context: GuardrailContext
  ) => GuardrailResult | Promise<GuardrailResult>;
}): Guardrail;
export function customGuardrail(
  nameOrOpts:
    | string
    | {
        name: string;
        target?: GuardrailTarget;
        maxRetries?: number;
        feedbackTemplate?: string;
        validate: (
          output: GuardrailInput,
          context: GuardrailContext
        ) => GuardrailResult | Promise<GuardrailResult>;
      },
  fn?: (
    output: GuardrailInput,
    ctx: GuardrailContext
  ) => GuardrailResult | Promise<GuardrailResult>,
  opts?: { maxRetries?: number; target?: GuardrailTarget }
): Guardrail {
  if (typeof nameOrOpts === 'string') {
    return {
      name: nameOrOpts,
      target: opts?.target ?? 'both',
      maxRetries: opts?.maxRetries ?? 2,
      validate: fn!,
    };
  }
  return {
    name: nameOrOpts.name,
    target: nameOrOpts.target,
    maxRetries: nameOrOpts.maxRetries,
    feedbackTemplate: nameOrOpts.feedbackTemplate,
    validate: nameOrOpts.validate,
  };
}

// ---------------------------------------------------------------------------
// composeGuardrails
// ---------------------------------------------------------------------------

export function composeGuardrails(guardrails: Guardrail[]): Guardrail;
export function composeGuardrails(opts: {
  name?: string;
  guardrails: Guardrail[];
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail;
export function composeGuardrails(
  guardrailsOrOpts:
    | Guardrail[]
    | {
        name?: string;
        guardrails: Guardrail[];
        maxRetries?: number;
        feedbackTemplate?: string;
      }
): Guardrail {
  const guardrails = Array.isArray(guardrailsOrOpts)
    ? guardrailsOrOpts
    : guardrailsOrOpts.guardrails;
  const name = Array.isArray(guardrailsOrOpts)
    ? `chain:[${guardrails.map(g => g.name).join(',')}]`
    : (guardrailsOrOpts.name ??
      `chain:[${guardrails.map(g => g.name).join(',')}]`);
  const maxRetries = Array.isArray(guardrailsOrOpts)
    ? guardrails.length > 0
      ? Math.max(...guardrails.map(g => g.maxRetries ?? 2))
      : 2
    : (guardrailsOrOpts.maxRetries ??
      (guardrails.length > 0
        ? Math.max(...guardrails.map(g => g.maxRetries ?? 2))
        : 2));
  const feedbackTemplate = Array.isArray(guardrailsOrOpts)
    ? undefined
    : guardrailsOrOpts.feedbackTemplate;

  return {
    name,
    target: 'both',
    maxRetries,
    feedbackTemplate,
    async validate(
      output: GuardrailInput,
      context: GuardrailContext
    ): Promise<GuardrailResult> {
      for (const g of guardrails) {
        const target = g.target ?? 'both';
        if (target === 'text' && output.toolCalls.length > 0) continue;
        if (target === 'tool-calls' && output.toolCalls.length === 0) continue;
        const result = await g.validate(output, context);
        if (!result.valid) return result;
      }
      return { valid: true };
    },
  };
}
