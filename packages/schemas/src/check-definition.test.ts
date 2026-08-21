import { describe, expect, it } from 'vitest';
import { CheckDefinitionSchema } from './check-definition.js';

describe('CheckDefinitionSchema', () => {
  it('parses a valid check', () => {
    const check = CheckDefinitionSchema.parse({
      name: 'syntax-check',
      command: 'node',
      args: ['--check', 'src/index.js'],
    });
    expect(check.args).toEqual(['--check', 'src/index.js']);
  });

  it('accepts an empty args list', () => {
    expect(CheckDefinitionSchema.parse({ name: 'lint', command: 'lint', args: [] }).args).toEqual(
      [],
    );
  });

  it('rejects a missing command', () => {
    expect(() => CheckDefinitionSchema.parse({ name: 'lint', args: [] })).toThrow();
  });

  it('rejects non-string args', () => {
    expect(() =>
      CheckDefinitionSchema.parse({ name: 'lint', command: 'lint', args: [1, 2] }),
    ).toThrow();
  });
});
