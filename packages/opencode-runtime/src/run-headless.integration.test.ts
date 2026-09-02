import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runOpencodeHeadless } from './run-headless.js';

const originalPath = process.env.PATH;
let fakeBinDir: string | undefined;

afterEach(async () => {
  process.env.PATH = originalPath;
  if (fakeBinDir) await rm(fakeBinDir, { recursive: true, force: true });
  fakeBinDir = undefined;
});

describe('runOpencodeHeadless subprocess integration', () => {
  it('delivers JSON events before the subprocess has finished', async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'arch-fake-opencode-stream-'));
    const fakeOpencodePath = join(fakeBinDir, 'opencode');
    await writeFile(
      fakeOpencodePath,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'step_start', sessionID: 'stream-session' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'text',
    sessionID: 'stream-session',
    part: { type: 'text', text: 'done' },
  }));
  console.log(JSON.stringify({
    type: 'step_finish',
    sessionID: 'stream-session',
    part: { reason: 'stop' },
  }));
}, 150);
`,
      'utf-8',
    );
    await chmod(fakeOpencodePath, 0o755);
    process.env.PATH = `${fakeBinDir}${delimiter}${originalPath ?? ''}`;

    let markProgressSeen: (() => void) | undefined;
    const progressSeen = new Promise<void>((resolve) => {
      markProgressSeen = resolve;
    });
    let settled = false;
    const resultPromise = runOpencodeHeadless({
      prompt: 'stream the turn',
      model: 'github-copilot/gpt-4.1',
      cwd: fakeBinDir,
      onEvent: (event) => {
        if (event.type === 'step_start') markProgressSeen?.();
      },
    }).finally(() => {
      settled = true;
    });

    const first = await Promise.race([
      progressSeen.then(() => 'progress' as const),
      resultPromise.then(() => 'completed' as const),
    ]);
    expect(first).toBe('progress');
    expect(settled).toBe(false);
    await expect(resultPromise).resolves.toEqual({ sessionId: 'stream-session', output: 'done' });
  });
});
