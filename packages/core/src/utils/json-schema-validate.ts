/**
 * Minimal JSON Schema validator — covers the subset needed for plugin
 * configSchema validation and tool inputSchema sanity checks. Intentionally
 * small (~80 lines, zero deps) and tolerant: unknown keywords are ignored so
 * authors can mix in non-standard extensions without breaking validation.
 *
 * NOT for full JSON Schema 2020-12 conformance. If a plugin needs $ref,
 * conditional schemas, format validation, or anything else exotic, it should
 * bring its own ajv-based validator and call this only for the cheap path.
 */
import type { JSONSchema } from '../types/tool.js';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export function validateAgainstSchema(value: unknown, schema: JSONSchema): ValidationResult {
  const errors: ValidationError[] = [];
  walk(value, schema, '', errors, 0);
  return { ok: errors.length === 0, errors };
}

/**
 * Maximum nesting depth before the validator stops recursing and reports a
 * "schema too deep" error. Deeply nested input (e.g. batch_tool_use with 100
 * nested calls → tool_use → input) can otherwise hit `RangeError: Maximum
 * call stack size exceeded` and crash the tool executor.
 *
 * 64 is generous: real-world tool schemas rarely nest beyond 5-6 levels, and
 * even pathological inputs (deeply recursive JSON) stay well under this.
 * The limit is a safety net against unbounded recursion, not a tight bound.
 */
const MAX_SCHEMA_DEPTH = 64;

function walk(
  value: unknown,
  schema: JSONSchema,
  path: string,
  errors: ValidationError[],
  depth: number,
): void {
  // P2 #8 (before-release.md): cap recursion depth to prevent
  // `RangeError: Maximum call stack size exceeded` on deeply nested input.
  // Push a validation error and stop descending — the caller still gets a
  // usable (ok: false) result instead of a crash.
  if (depth > MAX_SCHEMA_DEPTH) {
    errors.push({
      path: path || '<root>',
      message: `schema nesting exceeds maximum depth (${MAX_SCHEMA_DEPTH})`,
    });
    return;
  }
  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      errors.push({
        path: path || '<root>',
        message: `expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
      });
      return;
    }
  }

  if (typeof schema.type === 'string') {
    if (!checkType(value, schema.type)) {
      errors.push({
        path: path || '<root>',
        message: `expected ${schema.type}, got ${describeType(value)}`,
      });
      return;
    }
  }

  if (schema.type === 'object' && isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) {
        errors.push({ path: joinPath(path, req), message: 'required property missing' });
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          walk(obj[key], subSchema, joinPath(path, key), errors, depth + 1);
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], schema.items as JSONSchema, `${path}[${i}]`, errors, depth + 1);
    }
  }
}

function checkType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function joinPath(parent: string, key: string): string {
  if (!parent) return key;
  return `${parent}.${key}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}
