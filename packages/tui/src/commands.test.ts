import { describe, expect, it } from 'vitest';
import { parseHomeInput } from './commands.js';

describe('parseHomeInput', () => {
  it('treats blank input as empty', () => {
    expect(parseHomeInput('   ')).toEqual({ kind: 'empty' });
  });

  it('treats plain text as a request to start a new run', () => {
    expect(parseHomeInput('fix the login bug')).toEqual({
      kind: 'run',
      prompt: 'fix the login bug',
    });
  });

  it('parses a known slash command with no arguments', () => {
    expect(parseHomeInput('/settings')).toEqual({
      kind: 'command',
      name: 'settings',
      args: '',
      known: true,
    });
  });

  it('splits a slash command from its arguments', () => {
    expect(parseHomeInput('/runs   fix   ')).toEqual({
      kind: 'command',
      name: 'runs',
      args: 'fix',
      known: true,
    });
  });

  it('flags an unrecognized slash command as unknown', () => {
    expect(parseHomeInput('/nope')).toEqual({
      kind: 'command',
      name: 'nope',
      args: '',
      known: false,
    });
  });
});
