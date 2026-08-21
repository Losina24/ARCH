import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test file spins up a real daemon socket server plus real subprocesses (git
    // worktree/branch commands, npm install in install-deps.test.ts). Running files in
    // parallel oversubscribes the CPU and makes unrelated tests hit the default 5s
    // timeout under load — run them one at a time instead.
    fileParallelism: false,
  },
});
