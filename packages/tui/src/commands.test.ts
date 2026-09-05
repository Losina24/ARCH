import { describe, expect, it } from 'vitest';
import {
  type SlashCommand,
  isCommand,
  matchCommands,
  matchHomeCommands,
  parseHomeInput,
} from './commands.js';

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

  it('tolerates a space right after the slash, same as no space at all', () => {
    expect(parseHomeInput('/ quit')).toEqual({
      kind: 'command',
      name: 'quit',
      args: '',
      known: true,
    });
    expect(parseHomeInput('/   runs   fix')).toEqual({
      kind: 'command',
      name: 'runs',
      args: 'fix',
      known: true,
    });
  });

  it('is case-insensitive on the command name', () => {
    expect(parseHomeInput('/QUIT')).toEqual({
      kind: 'command',
      name: 'quit',
      args: '',
      known: true,
    });
    expect(parseHomeInput('/Runs fix')).toEqual({
      kind: 'command',
      name: 'runs',
      args: 'fix',
      known: true,
    });
  });
});

describe('matchHomeCommands', () => {
  it('suggests every command for a bare slash', () => {
    expect(matchHomeCommands('/').map((command) => command.name)).toEqual([
      'runs',
      'settings',
      'help',
      'quit',
      'close-all',
    ]);
  });

  it('suggests commands matching a partial name, tolerating a space after the slash', () => {
    expect(matchHomeCommands('/qu').map((command) => command.name)).toEqual(['quit']);
    expect(matchHomeCommands('/ qu').map((command) => command.name)).toEqual(['quit']);
  });

  it('stops suggesting once the input moves past the command name', () => {
    expect(matchHomeCommands('/quit ')).toEqual([]);
    expect(matchHomeCommands('/runs fix')).toEqual([]);
  });

  it('returns nothing for plain text', () => {
    expect(matchHomeCommands('hello')).toEqual([]);
  });
});

describe('isCommand', () => {
  it('matches the bare command, tolerating a space after the slash and any case', () => {
    expect(isCommand('/approve', 'approve')).toBe(true);
    expect(isCommand('/ approve', 'approve')).toBe(true);
    expect(isCommand('/APPROVE', 'approve')).toBe(true);
    expect(isCommand('  / approve  ', 'approve')).toBe(true);
  });

  it('still matches when trailing args are present', () => {
    expect(isCommand('/approve now', 'approve')).toBe(true);
  });

  it('rejects a different or malformed command', () => {
    expect(isCommand('/approved', 'approve')).toBe(false);
    expect(isCommand('approve', 'approve')).toBe(false);
    expect(isCommand('/abort', 'approve')).toBe(false);
  });
});

describe('matchCommands (generic list)', () => {
  it('filters an arbitrary command list the same way matchHomeCommands filters HOME_COMMANDS', () => {
    const list: SlashCommand[] = [
      { name: 'skip', description: 'Skip' },
      { name: 'done', description: 'Done' },
    ];
    expect(matchCommands('/sk', list).map((command) => command.name)).toEqual(['skip']);
    expect(matchCommands('/', list).map((command) => command.name)).toEqual(['skip', 'done']);
  });
});
