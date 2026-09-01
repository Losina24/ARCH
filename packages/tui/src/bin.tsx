#!/usr/bin/env node
import { resolveRunCwd } from '@losina/core';
import { render } from 'ink';
import { App } from './app.js';

try {
  const cwd = await resolveRunCwd(process.cwd());
  render(<App cwd={cwd} />);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
