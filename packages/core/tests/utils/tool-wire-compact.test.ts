import { describe, expect, it } from 'vitest';
import {
  compactSchemaDescriptions,
  compactToolDefinitionForWire,
} from '../../src/utils/tool-wire-compact.js';

describe('compactToolDefinitionForWire', () => {
  it('compacts prose while preserving schema structure and validation fields', () => {
    const long = 'Use this carefully. '.repeat(80);
    const schema = {
      type: 'object',
      description: long,
      required: ['path', 'mode'],
      properties: {
        path: {
          type: 'string',
          description: long,
          pattern: '^src/',
        },
        mode: {
          type: 'string',
          enum: ['content', 'summary'],
          description: long,
        },
      },
    };

    const compact = compactToolDefinitionForWire(
      {
        name: 'read',
        description: long,
        inputSchema: schema,
      },
      { descriptionMaxChars: 120, schemaDescriptionMaxChars: 80 },
    );

    expect(compact.name).toBe('read');
    expect(compact.description.length).toBeLessThanOrEqual(120);
    expect(compact.inputSchema).toMatchObject({
      type: 'object',
      required: ['path', 'mode'],
      properties: {
        path: { type: 'string', pattern: '^src/' },
        mode: { type: 'string', enum: ['content', 'summary'] },
      },
    });
    const props = compact.inputSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(String(compact.inputSchema['description']).length).toBeLessThanOrEqual(80);
    expect(String(props['path']?.['description']).length).toBeLessThanOrEqual(80);
    expect(String(props['mode']?.['description']).length).toBeLessThanOrEqual(80);
  });

  it('does not mutate the original schema object', () => {
    const original = {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'A'.repeat(500) },
      },
    };

    compactSchemaDescriptions(original, 50);

    const props = original.properties as Record<string, { description: string }>;
    expect(props['command']?.description).toHaveLength(500);
  });

  it('falls back to an empty object schema for invalid schema values', () => {
    expect(compactSchemaDescriptions(undefined)).toEqual({ type: 'object', properties: {} });
    expect(compactSchemaDescriptions('bad')).toEqual({ type: 'object', properties: {} });
  });
});
