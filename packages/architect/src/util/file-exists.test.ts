import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileExists } from './file-exists.js';

describe('fileExists', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arch-file-exists-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns true for a file that exists', async () => {
    const path = join(dir, 'present.txt');
    await writeFile(path, 'hi', 'utf-8');
    expect(await fileExists(path)).toBe(true);
  });

  it('returns false for a path that does not exist', async () => {
    expect(await fileExists(join(dir, 'absent.txt'))).toBe(false);
  });
});
