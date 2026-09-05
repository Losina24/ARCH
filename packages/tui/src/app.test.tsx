import type { ArchClient } from '@losina/daemon-client';
import { ensureDaemon } from '@losina/daemon-client';
import type { RunMeta } from '@losina/schemas';
import type { Stdin } from 'ink-testing-library';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app.js';

vi.mock('@losina/daemon-client', () => ({ ensureDaemon: vi.fn() }));

const mockedEnsureDaemon = vi.mocked(ensureDaemon);

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function press(stdin: Stdin, sequence: string): Promise<void> {
  stdin.write(sequence);
  await tick();
}

async function type(stdin: Stdin, text: string): Promise<void> {
  for (const char of text) {
    await press(stdin, char);
  }
}

describe('App', () => {
  it('shows a connecting message before the daemon connection resolves', async () => {
    mockedEnsureDaemon.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(<App cwd="/tmp/project" />);

    expect(lastFrame()).toContain('Connecting to ARCH daemon…');
  });

  it('shows an error message when the daemon connection fails', async () => {
    mockedEnsureDaemon.mockRejectedValue(new Error('daemon.log says boom'));
    const { lastFrame } = render(<App cwd="/tmp/project" />);

    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Failed to connect to ARCH daemon: daemon.log says boom'),
    );
  });

  it('renders the home view once connected', async () => {
    const client = {
      listRuns: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({
        models: {
          architectModel: 'claude-opus-5',
          workerModel: 'claude-sonnet-5',
        },
        execution: { maxConcurrency: 4, maxRetries: 3, useWorktrees: true },
      }),
    } as unknown as ArchClient;
    mockedEnsureDaemon.mockResolvedValue(client);
    const { lastFrame } = render(<App cwd="/tmp/project" />);

    await vi.waitFor(() => expect(lastFrame()).toContain('/tmp/project'));
    // The boot splash animation runs for a couple of seconds before the resting
    // splash (prompt box, etc.) appears, so this needs more than the default timeout.
    await vi.waitFor(
      () => expect(lastFrame()).toContain('Describe your task and give instructions'),
      { timeout: 8000 },
    );
  }, 10_000);

  it('does not replay the boot splash animation when returning to Home from a run', async () => {
    const run: RunMeta = {
      runId: 'run-1',
      title: 'Add login page',
      prompt: 'Add a login page',
      cwd: '/tmp/project',
      phase: 'definition',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const client = {
      listRuns: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({
        models: {
          architectModel: 'claude-opus-5',
          workerModel: 'claude-sonnet-5',
        },
        execution: { maxConcurrency: 4, maxRetries: 3, useWorktrees: true },
      }),
      createRun: vi.fn().mockResolvedValue(run),
      getRunPlan: vi.fn().mockResolvedValue(null),
      getRunEvents: vi.fn().mockResolvedValue([]),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as ArchClient;
    mockedEnsureDaemon.mockResolvedValue(client);
    const { lastFrame, stdin } = render(<App cwd="/tmp/project" />);

    await vi.waitFor(
      () => expect(lastFrame()).toContain('Describe your task and give instructions'),
      { timeout: 8000 },
    );

    await type(stdin, 'Add a login page');
    await press(stdin, '\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('Waiting for the Architect'));

    await press(stdin, '\x1B');
    // With bootAnimationMs forced to 0 on this remount, HomeView's screen state initializes
    // straight to 'splash' — no useEffect/animation frame is needed for the prompt to appear,
    // so asserting immediately (no waitFor) proves the boot animation never got a chance to run.
    expect(lastFrame()).toContain('Describe your task and give instructions');
  }, 10_000);
});
