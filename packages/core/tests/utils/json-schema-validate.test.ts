import { describe, expect, it } from 'vitest';
import type { JSONSchema } from '../../src/types/tool.js';
import { validateAgainstSchema } from '../../src/utils/json-schema-validate.js';

describe('json-schema-validate / validateAgainstSchema', () => {
  describe('primitive types', () => {
    it('accepts a matching string', () => {
      const r = validateAgainstSchema('hello', { type: 'string' });
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    });

    it('rejects wrong primitive type', () => {
      const r = validateAgainstSchema(42, { type: 'string' });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/expected string, got number/);
      expect(r.errors[0].path).toBe('<root>');
    });

    it('accepts number', () => {
      expect(validateAgainstSchema(3.14, { type: 'number' }).ok).toBe(true);
    });

    it('rejects NaN for number', () => {
      expect(validateAgainstSchema(Number.NaN, { type: 'number' }).ok).toBe(false);
    });

    it('accepts integer for integer type', () => {
      expect(validateAgainstSchema(7, { type: 'integer' }).ok).toBe(true);
    });

    it('rejects float for integer type', () => {
      expect(validateAgainstSchema(7.5, { type: 'integer' }).ok).toBe(false);
    });

    it('accepts boolean', () => {
      expect(validateAgainstSchema(true, { type: 'boolean' }).ok).toBe(true);
      expect(validateAgainstSchema(false, { type: 'boolean' }).ok).toBe(true);
    });

    it('accepts null only for null type', () => {
      expect(validateAgainstSchema(null, { type: 'null' }).ok).toBe(true);
      expect(validateAgainstSchema(undefined, { type: 'null' }).ok).toBe(false);
    });

    it('distinguishes array from object', () => {
      expect(validateAgainstSchema([], { type: 'array' }).ok).toBe(true);
      expect(validateAgainstSchema([], { type: 'object' }).ok).toBe(false);
      expect(validateAgainstSchema({}, { type: 'object' }).ok).toBe(true);
      expect(validateAgainstSchema({}, { type: 'array' }).ok).toBe(false);
    });

    it('reports describeType correctly for null and arrays', () => {
      const r1 = validateAgainstSchema(null, { type: 'string' });
      expect(r1.errors[0].message).toMatch(/got null/);
      const r2 = validateAgainstSchema([], { type: 'string' });
      expect(r2.errors[0].message).toMatch(/got array/);
    });
  });

  describe('object properties', () => {
    it('reports missing required keys', () => {
      const schema: JSONSchema = {
        type: 'object',
        required: ['name', 'age'],
        properties: { name: { type: 'string' }, age: { type: 'number' } },
      };
      const r = validateAgainstSchema({ name: 'a' }, schema);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].path).toBe('age');
      expect(r.errors[0].message).toMatch(/required/);
    });

    it('validates each declared property', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
      };
      const r = validateAgainstSchema({ name: 1, age: 'x' }, schema);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(2);
      expect(r.errors.map((e) => e.path).sort()).toEqual(['age', 'name']);
    });

    it('ignores unknown properties (open by default)', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
      };
      const r = validateAgainstSchema({ name: 'a', extra: 123 }, schema);
      expect(r.ok).toBe(true);
    });

    it('uses dotted paths for nested errors', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          inner: {
            type: 'object',
            properties: { x: { type: 'number' } },
          },
        },
      };
      const r = validateAgainstSchema({ inner: { x: 'no' } }, schema);
      expect(r.ok).toBe(false);
      expect(r.errors[0].path).toBe('inner.x');
    });

    it('does not walk properties when value is not an object', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      const r = validateAgainstSchema('not an object', schema);
      expect(r.ok).toBe(false);
      // First type mismatch short-circuits; no `name required missing` error.
      expect(r.errors).toHaveLength(1);
    });
  });

  describe('array items', () => {
    it('validates each item against schema', () => {
      const schema: JSONSchema = { type: 'array', items: { type: 'number' } };
      const r = validateAgainstSchema([1, 'two', 3], schema);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].path).toBe('[1]');
    });

    it('accepts empty array', () => {
      const r = validateAgainstSchema([], { type: 'array', items: { type: 'number' } });
      expect(r.ok).toBe(true);
    });

    it('flags multiple bad items separately', () => {
      const schema: JSONSchema = { type: 'array', items: { type: 'number' } };
      const r = validateAgainstSchema(['a', 'b'], schema);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(2);
      expect(r.errors.map((e) => e.path)).toEqual(['[0]', '[1]']);
    });
  });

  describe('enum', () => {
    it('accepts a listed primitive', () => {
      const r = validateAgainstSchema('red', { enum: ['red', 'green', 'blue'] });
      expect(r.ok).toBe(true);
    });

    it('rejects a value not in the list', () => {
      const r = validateAgainstSchema('yellow', { enum: ['red', 'green', 'blue'] });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/expected one of/);
    });

    it('uses deep equality for objects', () => {
      const r = validateAgainstSchema({ a: 1, b: 2 }, { enum: [{ a: 1, b: 2 }] });
      expect(r.ok).toBe(true);
    });

    it('uses deep equality for arrays', () => {
      const r = validateAgainstSchema([1, 2, 3], { enum: [[1, 2, 3]] });
      expect(r.ok).toBe(true);
      const r2 = validateAgainstSchema([1, 2], { enum: [[1, 2, 3]] });
      expect(r2.ok).toBe(false);
    });

    it('short-circuits on enum mismatch (no further checks)', () => {
      const r = validateAgainstSchema(42, { enum: [1, 2], type: 'string' });
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].message).toMatch(/expected one of/);
    });
  });

  describe('unknown / extensible keywords', () => {
    it('ignores unknown type identifiers', () => {
      const r = validateAgainstSchema('anything', { type: 'made-up-type' as never });
      expect(r.ok).toBe(true);
    });

    it('accepts a schema with no constraints', () => {
      const r = validateAgainstSchema(42, {});
      expect(r.ok).toBe(true);
    });
  });
});
