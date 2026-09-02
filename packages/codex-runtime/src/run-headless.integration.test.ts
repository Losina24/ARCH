import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCodexHeadless } from './run-headless.js';

const originalPath = process.env.PATH;
let fakeBinDir: string | undefined;

afterEach(async () => {
  process.env.PATH = originalPath;
  if (fakeBinDir) await rm(fakeBinDir, { recursive: true, force: true });
  fakeBinDir = undefined;
});

describe('runCodexHeadless subprocess integration', () => {
  it('delivers the complete prompt through stdin, closes it, and keeps it out of argv', async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'arch-fake-codex-'));
    const fakeCodexPath = join(fakeBinDir, 'codex');
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: JSON.stringify({ argv: process.argv.slice(2), input }),
    },
  }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
});
`,
      'utf-8',
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.PATH = `${fakeBinDir}${delimiter}${originalPath ?? ''}`;

    const prompt = 'prompt with spaces\nand a second line';
    const result = await runCodexHeadless({
      prompt,
      model: 'codex',
      cwd: fakeBinDir,
      timeoutMs: 10_000,
    });

    expect(result.sessionId).toBe('fake-thread');
    const payload = JSON.parse(result.output) as { argv: string[]; input: string };
    expect(payload.input).toBe(prompt);
    expect(payload.argv.at(-1)).toBe('-');
    expect(payload.argv).not.toContain(prompt);
  });

  it('delivers JSONL events before the subprocess has finished', async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'arch-fake-codex-stream-'));
    const fakeCodexPath = join(fakeBinDir, 'codex');
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'stream-thread' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({
    type: 'item.started',
    item: { type: 'command_execution', command: 'pnpm test' },
  }));
  setTimeout(() => {
    console.log(JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'done' },
    }));
    console.log(JSON.stringify({ type: 'turn.completed' }));
  }, 150);
});
`,
      'utf-8',
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.PATH = `${fakeBinDir}${delimiter}${originalPath ?? ''}`;

    let markProgressSeen: (() => void) | undefined;
    const progressSeen = new Promise<void>((resolve) => {
      markProgressSeen = resolve;
    });
    let settled = false;
    const resultPromise = runCodexHeadless({
      prompt: 'stream the turn',
      model: 'codex',
      cwd: fakeBinDir,
      timeoutMs: 10_000,
      onEvent: (event) => {
        if (event.type === 'item.started') markProgressSeen?.();
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
    await expect(resultPromise).resolves.toMatchObject({
      sessionId: 'stream-thread',
      output: 'done',
    });
  }, 15_000);
});
