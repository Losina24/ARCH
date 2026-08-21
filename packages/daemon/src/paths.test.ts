import { describe, expect, it } from 'vitest';
import { DAEMON_BIN_PATH } from './paths.js';

describe('DAEMON_BIN_PATH', () => {
  it('resolves to an absolute path pointing at the compiled bin.js entrypoint', () => {
    expect(DAEMON_BIN_PATH.startsWith('/')).toBe(true);
    expect(DAEMON_BIN_PATH.endsWith('bin.js')).toBe(true);
  });
});
