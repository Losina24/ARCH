import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAEMON_BIN_PATH } from './paths.js';

describe('DAEMON_BIN_PATH', () => {
  it('resolves to an absolute path pointing at the compiled bin.js entrypoint', () => {
    expect(isAbsolute(DAEMON_BIN_PATH)).toBe(true);
    expect(DAEMON_BIN_PATH.endsWith('bin.js')).toBe(true);
  });
});
