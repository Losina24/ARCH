import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runClaudeHeadless } from './run-headless.js';

const originalPath = process.env.PATH;
let fakeBinDir: string | undefined;

afterEach(async () => {
  process.env.PATH = originalPath;
  if (fakeBinDir) await rm(fakeBinDir, { recursive: true, force: true });
  fakeBinDir = undefined;
});

describe('runClaudeHeadless subprocess integration', () => {
  it('delivers stream-json events before the subprocess has finished', async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'arch-fake-claude-stream-'));
    const fakeClaudePath = join(fakeBinDir, 'claude');
    await writeFile(
      fakeClaudePath,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'stream-session' }));
console.log(JSON.stringify({
  type: 'assistant',
  message: {
    content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }],
  },
}));
setTimeout(() => {
  console.log(JSON.stringify({ type: 'result', session_id: 'stream-session', result: 'done' }));
}, 150);
`,
      'utf-8',
    );
    await chmod(fakeClaudePath, 0o755);
    process.env.PATH = `${fakeBinDir}${delimiter}${originalPath ?? ''}`;

    let markProgressSeen: (() => void) | undefined;
    const progressSeen = new Promise<void>((resolve) => {
      markProgressSeen = resolve;
    });
    let settled = false;
    const resultPromise = runClaudeHeadless({
      prompt: 'stream the turn',
      model: 'sonnet',
      cwd: fakeBinDir,
      onEvent: (event) => {
        if (event.type === 'assistant') markProgressSeen?.();
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
