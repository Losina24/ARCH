import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test file spins up a real daemon socket server plus real subprocesses (git
    // worktree/branch commands, npm install in install-deps.test.ts). Running files in
    // parallel oversubscribes the CPU, so run them one at a time. The monorepo still
    // executes other packages alongside this one, so keep the outer Vitest timeout above
    // the scenarios' own 30s event deadline to avoid load-dependent false failures.
    fileParallelism: false,
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
