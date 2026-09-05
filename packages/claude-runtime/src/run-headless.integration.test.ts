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

// A bare, extension-less, shebang'd file (the POSIX way to fake a PATH executable) loses to a
// real `claude` binary elsewhere on PATH on Windows: PATHEXT-based resolution matches every
// directory against `.COM`/`.EXE`/`.BAT`/`.CMD`/etc first and only falls back to trying the bare
// filename if nothing on the whole PATH matched any extension — so a real claude.exe installed
// for local dev wins even though this fake bin dir is prepended. A `.cmd` shim is matched during
// that same extension pass, so it wins the race instead.
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

describe('runClaudeHeadless subprocess integration', () => {
  // Regression test for a real production incident: a task's review prompt (brief + diff +
  // corrections) can run well past Windows' ~32K-character command-line limit. Passing it as an
  // argv element makes the OS refuse to even spawn `claude` (ENAMETOOLONG) on this exact
  // platform — verified separately by hand against the real limit. This proves the actual
  // property that makes the limit irrelevant: the full prompt travels through a real OS pipe
  // (stdin) rather than argv, so its size never matters, using a prompt several times larger
  // than the limit that broke the live run this test is guarding against.
  it('delivers a prompt far larger than the Windows command-line limit through stdin, keeping it out of argv', async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'arch-fake-claude-stdin-'));
    await writeFakeExecutable(
      fakeBinDir,
      'claude',
      `let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    type: 'result',
    session_id: 'stdin-session',
    result: JSON.stringify({ argv: process.argv.slice(2), inputLength: input.length }),
  }));
});
`,
    );
    process.env.PATH = `${fakeBinDir}${delimiter}${originalPath ?? ''}`;

    const hugePrompt = 'x'.repeat(200_000);
    const result = await runClaudeHeadless({
      prompt: hugePrompt,
      model: 'sonnet',
      cwd: fakeBinDir,
    });

    expect(result.sessionId).toBe('stdin-session');
    const payload = JSON.parse(result.output) as { argv: string[]; inputLength: number };
    expect(payload.inputLength).toBe(hugePrompt.length);
    expect(payload.argv.some((arg) => arg.length > 1000)).toBe(false);
  });

  it('delivers stream-json events before the subprocess has finished', async () => {
    fakeBinDir = await mkdtemp(join(tmpdir(), 'arch-fake-claude-stream-'));
    await writeFakeExecutable(
      fakeBinDir,
      'claude',
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'stream-session' }));
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
    );
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
