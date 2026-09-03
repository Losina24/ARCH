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

// A bare, extension-less, shebang'd file (the POSIX way to fake a PATH executable) loses to a
// real `codex` binary elsewhere on PATH on Windows: PATHEXT-based resolution matches every
// directory against `.COM`/`.EXE`/`.BAT`/`.CMD`/etc first and only falls back to trying the bare
// filename if nothing on the whole PATH matched any extension — so a real codex install would
// win even though this fake bin dir is prepended. A `.cmd` shim is matched during that same
// extension pass, so it wins the race instead.
async function writeFakeExecutable(dir: string, name: string, script: string): Promise<void> {
  if (process.platform === 'win32') {
    const scriptPath = join(dir, `${name}.js`);
    await writeFile(scriptPath, script, 'utf-8');
    await writeFile(join(dir, `${name}.cmd`), `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf-8');
    return;
  }
  const binPath = join(dir, name);
  await writeFile(binPath, `#!/usr/bin/env node\n${script}`, 'utf-8');
  await chmod(binPath, 0o755);
}

describe('runCodexHeadless subprocess integration', () => {
  it('delivers the complete prompt through stdin, closes it, and keeps it out of argv', async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'arch-fake-codex-'));
    await writeFakeExecutable(
      fakeBinDir,
      'codex',
      `let input = '';
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
    );
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
    await writeFakeExecutable(
      fakeBinDir,
      'codex',
      `process.stdin.resume();
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
    );
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
