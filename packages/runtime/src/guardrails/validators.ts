/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Guardrail,
  GuardrailError,
  GuardrailInput,
  GuardrailContext,
  GuardrailResult,
  GuardrailTarget,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal: lightweight JSON Schema subset validator
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

function validateSchema(
  value: unknown,
  schema: Schema,
  path: string
): GuardrailError[] {
  const errors: GuardrailError[] = [];

  // type check
  if ('type' in schema) {
    const expected = schema['type'] as string;
    if (!checkType(value, expected)) {
      errors.push({
        path: path || '(root)',
        message: `Expected type "${expected}" but got "${typeOf(value)}"`,
        code: 'type',
      });
      return errors; // short-circuit on type mismatch
    }
  }

  // enum check
  if ('enum' in schema) {
    const allowed = schema['enum'] as unknown[];
    if (!allowed.some(v => JSON.stringify(v) === JSON.stringify(value))) {
      errors.push({
        path: path || '(root)',
        message: `Value must be one of: ${JSON.stringify(allowed)}`,
        code: 'enum',
      });
    }
  }

  // number constraints
  if (typeof value === 'number') {
    if ('minimum' in schema && value < (schema['minimum'] as number)) {
      errors.push({
        path: path || '(root)',
        message: `Value ${value} is less than minimum ${schema['minimum']}`,
        code: 'minimum',
      });
    }
    if ('maximum' in schema && value > (schema['maximum'] as number)) {
      errors.push({
        path: path || '(root)',
        message: `Value ${value} is greater than maximum ${schema['maximum']}`,
        code: 'maximum',
      });
    }
  }

  // string constraints
  if (typeof value === 'string') {
    if (
      'minLength' in schema &&
      value.length < (schema['minLength'] as number)
    ) {
      errors.push({
        path: path || '(root)',
        message: `String length ${value.length} is less than minLength ${schema['minLength']}`,
        code: 'minLength',
      });
    }
    if (
      'maxLength' in schema &&
      value.length > (schema['maxLength'] as number)
    ) {
      errors.push({
        path: path || '(root)',
        message: `String length ${value.length} is greater than maxLength ${schema['maxLength']}`,
        code: 'maxLength',
      });
    }
    if ('pattern' in schema) {
      const re = new RegExp(schema['pattern'] as string);
      if (!re.test(value)) {
        errors.push({
          path: path || '(root)',
          message: `String does not match pattern "${schema['pattern']}"`,
          code: 'pattern',
        });
      }
    }
  }

  // object constraints
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // required
    if ('required' in schema) {
      const required = schema['required'] as string[];
      for (const key of required) {
        if (!(key in obj)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Missing required property "${key}"`,
            code: 'required',
          });
        }
      }
    }

    // properties
    if ('properties' in schema) {
      const props = schema['properties'] as Record<string, Schema>;
      for (const [key, subSchema] of Object.entries(props)) {
        if (key in obj) {
          const subPath = path ? `${path}.${key}` : key;
          errors.push(...validateSchema(obj[key], subSchema, subPath));
        }
      }
    }

    // additionalProperties
    if (
      'additionalProperties' in schema &&
      schema['additionalProperties'] === false
    ) {
      const allowed = Object.keys(
        (schema['properties'] as Record<string, unknown>) ?? {}
      );
      for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Additional property "${key}" is not allowed`,
            code: 'additionalProperties',
          });
        }
      }
    }
  }

  // array constraints
  if (Array.isArray(value)) {
    if ('items' in schema) {
      const itemSchema = schema['items'] as Schema;
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        errors.push(...validateSchema(value[i], itemSchema, itemPath));
      }
    }
  }

  return errors;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

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
