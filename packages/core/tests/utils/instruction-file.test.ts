import { describe, expect, it } from 'vitest';
import { renderInstructionTemplate } from '../../src/utils/instruction-file.js';

describe('renderInstructionTemplate', () => {
  // renderInstructionTemplate is the canonical "fill in the {{blanks}}"
  // helper for instruction prompts. The contract:
  //   - {{name}} / {{ name }} / {{name }} are all treated the same
  //     (the regex tolerates optional whitespace inside the braces)
  //   - Identifier characters: [a-zA-Z0-9_.-] (so foo.bar and foo-bar
  //     are valid; foo bar is not — it would be ignored as a literal)
  //   - Unknown keys are left as the literal placeholder (so the
  //     caller can see "you forgot to pass this" rather than getting
  //     a silent empty string)
  //   - Keys whose value is the empty string ARE replaced with '' (not
  //     left as the literal — the user passed an empty value on
  //     purpose, the call site shouldn't get a placeholder back)

  it('substitutes a single placeholder', () => {
    expect(renderInstructionTemplate('Hello, {{name}}!', { name: 'world' })).toBe('Hello, world!');
  });

  it('substitutes multiple placeholders', () => {
    expect(
      renderInstructionTemplate('{{greeting}}, {{name}}!', {
        greeting: 'Hi',
        name: 'Alice',
      }),
    ).toBe('Hi, Alice!');
  });

  it('tolerates optional whitespace inside the braces', () => {
    expect(renderInstructionTemplate('{{ name }}', { name: 'X' })).toBe('X');
    expect(renderInstructionTemplate('{{name }}', { name: 'X' })).toBe('X');
    expect(renderInstructionTemplate('{{ name}}', { name: 'X' })).toBe('X');
  });

  it('accepts dotted and dashed identifiers', () => {
    // The regex [a-zA-Z0-9_.-] covers both. Pin both so a future
    // tightening of the regex to [a-zA-Z0-9_] is a deliberate
    // breaking change.
    expect(renderInstructionTemplate('{{user.name}}', { 'user.name': 'alice' })).toBe('alice');
    expect(renderInstructionTemplate('{{user-id}}', { 'user-id': 'u123' })).toBe('u123');
  });

  it('leaves unknown placeholders as literal text', () => {
    // The contract is "unknown → match". The function returns the
    // original placeholder so the caller can see "you forgot to pass
    // this" rather than getting a silent empty string.
    expect(renderInstructionTemplate('Hello, {{name}}!', {})).toBe('Hello, {{name}}!');
  });

  it('replaces known keys with the empty string when their value is empty', () => {
    // Distinct from "unknown key" — a known key with value '' is
    // substituted with '' (the user passed an empty value on purpose).
    // The function uses `values[key] ?? ''` so undefined is also
    // replaced by ''.
    expect(renderInstructionTemplate('Hello, {{name}}!', { name: '' })).toBe('Hello, !');
  });

  it('returns the template unchanged when it has no placeholders', () => {
    expect(renderInstructionTemplate('Hello, world!', { name: 'X' })).toBe('Hello, world!');
  });

  it('handles a string with no placeholders and an empty values map', () => {
    expect(renderInstructionTemplate('no placeholders here', {})).toBe('no placeholders here');
  });
});
