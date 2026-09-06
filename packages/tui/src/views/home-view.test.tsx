import type { ArchClient } from '@losina/daemon-client';
import type { AgentMeshConfig, RunMeta } from '@losina/schemas';
import type { Stdin } from 'ink-testing-library';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { HomeView } from './home-view.js';

const config: AgentMeshConfig = {
  models: {
    architectModel: 'claude-opus-5',
    workerModel: 'claude-sonnet-5',
  },
  execution: {
    maxConcurrency: 4,
    maxRetries: 3,
    useWorktrees: true,
  },
};

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// vi.waitFor's own default timeout is 1000ms, which is tight enough that these
// screen-transition assertions have failed intermittently on GitHub Actions' slower/more
// contended runners even though they pass reliably (and fast) locally. Give them more room.
//
// This inner budget must stay below vitest's own per-test timeout (see the `vi.setConfig` call
// below) — otherwise the outer test timeout fires first (since it starts counting from the test's
// start, before this helper is even called) and this 5s budget never actually gets a chance to run
// out on its own terms.
const WAIT_FOR_TIMEOUT_MS = 5000;
function waitFor(assertion: () => void): Promise<void> {
  return vi.waitFor(assertion, { timeout: WAIT_FOR_TIMEOUT_MS });
}

// Must exceed WAIT_FOR_TIMEOUT_MS with real margin — vitest's own default testTimeout is also
// 5000ms, which raced the helper above and always won, so `waitFor` was never actually getting the
// 5 seconds it was supposed to.
vi.setConfig({ testTimeout: WAIT_FOR_TIMEOUT_MS + 5000 });

async function press(stdin: Stdin, sequence: string): Promise<void> {
  stdin.write(sequence);
  await tick();
}

async function type(stdin: Stdin, text: string): Promise<void> {
  for (const char of text) {
    await press(stdin, char);
  }
}

function runMeta(overrides: Partial<RunMeta>): RunMeta {
  return {
    runId: 'run-1',
    title: 'Add login page',
    prompt: 'Add a login page',
    cwd: '/tmp/project',
    phase: 'definition',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockClient(overrides: Partial<ArchClient> = {}): ArchClient {
  return {
    listRuns: vi.fn().mockResolvedValue([]),
    createRun: vi.fn(),
    getConfig: vi.fn().mockResolvedValue(config),
    deleteRun: vi.fn().mockResolvedValue({ ok: true }),
    onEvent: vi.fn().mockReturnValue(vi.fn()),
    ...overrides,
  } as unknown as ArchClient;
}

describe('HomeView', () => {
  it('shows the ARCH logo, the prompt and the cwd in the status bar', async () => {
    const client = mockClient();
    const { lastFrame } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('█');
    expect(frame).toContain('Describe your task and give instructions');
    expect(frame).toContain('/tmp/project');
  });

  it('shows non-terminated runs in a top bar on the splash screen', async () => {
    const runs = [
      runMeta({ runId: 'run-1', title: 'Add login page', phase: 'implementation' }),
      runMeta({ runId: 'run-2', title: 'Fix flaky test', phase: 'done' }),
      runMeta({ runId: 'run-3', title: 'Refactor auth', phase: 'blocked' }),
    ];
    const client = mockClient({ listRuns: vi.fn().mockResolvedValue(runs) });
    const { lastFrame } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('[implementation] Add login page');
      expect(frame).not.toContain('Fix flaky test');
      expect(frame).not.toContain('Refactor auth');
    });
  });

  it('renders no top bar on the splash screen when every run is done or blocked', async () => {
    const runs = [runMeta({ runId: 'run-1', title: 'Add login page', phase: 'done' })];
    const client = mockClient({ listRuns: vi.fn().mockResolvedValue(runs) });
    const { lastFrame } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await waitFor(() => {
      expect(lastFrame()).toContain('Describe your task and give instructions');
    });
    expect(lastFrame()).not.toContain('[done] Add login page');
  });

  it('treats typed text as a new run and opens it once created', async () => {
    const created = runMeta({ runId: 'run-new', title: 'fix bug' });
    const client = mockClient({ createRun: vi.fn().mockResolvedValue(created) });
    const onOpenRun = vi.fn();
    const { stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={onOpenRun} />,
    );

    await tick();
    await type(stdin, 'fix bug');
    await press(stdin, '\r');

    await waitFor(() => expect(onOpenRun).toHaveBeenCalledWith(created));
    expect(client.createRun).toHaveBeenCalledWith({ prompt: 'fix bug', cwd: '/tmp/project' });
  });

  it('opens a centered settings modal on /settings, without replacing the splash screen behind it', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/settings');
    await press(stdin, '\r');

    await waitFor(() => expect(lastFrame()).toContain('Settings'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Architect model');
    expect(frame).toContain('claude-opus-5');
    expect(frame).toContain('█');
  });

  it('closes the settings modal and returns to the splash on escape', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/settings');
    await press(stdin, '\r');
    await waitFor(() => expect(lastFrame()).toContain('Settings'));

    await press(stdin, '\x1b');
    await waitFor(() => expect(lastFrame()).not.toContain('Settings'));
    expect(lastFrame()).toContain('Describe your task and give instructions');
  });

  it('refreshes the models hint immediately after saving settings', async () => {
    const updated: AgentMeshConfig = {
      ...config,
      models: {
        architectModel: 'gpt-5.6-sol',
        workerModel: 'gpt-5.6-luna',
      },
    };
    const client = mockClient({ setConfig: vi.fn().mockResolvedValue(updated) });
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await type(stdin, '/settings');
    await press(stdin, '\r');
    await waitFor(() => expect(lastFrame()).toContain('Settings'));

    await press(stdin, 's');
    await waitFor(() => expect(lastFrame()).toContain('Saved.'));
    await press(stdin, '\x1b');

    await waitFor(() => expect(lastFrame()).toContain('gpt-5.6-sol'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('gpt-5.6-luna');
    expect(frame).not.toContain('claude-opus-5');
  });

  it('shows a floating command menu filtered by what is typed after /', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/r');

    const frame = lastFrame() ?? '';
    expect(frame).toContain('/runs');
    expect(frame).not.toContain('/settings');
  });

  it('moves the command-menu highlight with the arrow keys instead of scrolling or typing', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/');
    // HOME_COMMANDS order: runs, settings, help, quit, close-all — two downs lands on "help".
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');

    const lines = (lastFrame() ?? '').split('\n');
    const cursorLine = lines.find((line) => line.includes('❯'));
    expect(cursorLine).toContain('/help');
  });

  it('fills the input with the highlighted command on Tab, without running it', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/');
    await press(stdin, '\x1b[B'); // highlight "settings"
    await press(stdin, '\t');

    expect(lastFrame()).not.toContain('Settings');
    expect(lastFrame()).toContain('/settings');
  });

  it('runs the highlighted command on Enter even when the typed text is only a prefix', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await type(stdin, '/se');
    await press(stdin, '\r');

    await waitFor(() => expect(lastFrame()).toContain('Settings'));
  });

  it('lists runs via /runs and opens the selected one', async () => {
    const onOpenRun = vi.fn();
    const runs = [
      runMeta({ runId: 'run-1', title: 'First run' }),
      runMeta({ runId: 'run-2', title: 'Second run' }),
    ];
    const client = mockClient({ listRuns: vi.fn().mockResolvedValue(runs) });
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={onOpenRun} />,
    );

    await tick();
    await type(stdin, '/runs');
    await press(stdin, '\r');

    // "First run" alone isn't specific enough — the splash-screen ActiveRunsBar renders it too
    // while the run is active, so wait for the "Runs" heading to confirm the screen switched.
    await waitFor(() => {
      expect(lastFrame()).toContain('Runs');
      expect(lastFrame()).toContain('First run');
    });
    expect(lastFrame()).toContain('Second run');

    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    expect(onOpenRun).toHaveBeenCalledWith(runs[1]);
  });

  it('filters the runs list as the user types, then clears the filter on escape', async () => {
    const runs = [
      runMeta({ runId: 'run-1', title: 'First run' }),
      runMeta({ runId: 'run-2', title: 'Second run' }),
    ];
    const client = mockClient({ listRuns: vi.fn().mockResolvedValue(runs) });
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/runs');
    await press(stdin, '\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Runs');
      expect(lastFrame()).toContain('First run');
    });

    await type(stdin, 'sec');
    await waitFor(() => expect(lastFrame()).not.toContain('First run'));
    expect(lastFrame()).toContain('Second run');

    await press(stdin, '\x1b');
    await waitFor(() => expect(lastFrame()).toContain('First run'));
    expect(lastFrame()).toContain('Second run');
  });

  it('deletes the selected run via ctrl+d after confirming, refreshing the list', async () => {
    const runs = [
      runMeta({ runId: 'run-1', title: 'First run' }),
      runMeta({ runId: 'run-2', title: 'Second run' }),
    ];
    const client = mockClient({ listRuns: vi.fn().mockResolvedValue(runs) });
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/runs');
    await press(stdin, '\r');
    // Both the runs screen and the splash-screen ActiveRunsBar can render "First run" (its phase
    // is active), so wait for the "Runs" heading too — otherwise this can resolve while still on
    // the splash screen, before the ctrl+d below has a runs list to act on.
    await waitFor(() => {
      expect(lastFrame()).toContain('Runs');
      expect(lastFrame()).toContain('First run');
    });

    await press(stdin, '\x04');
    await waitFor(() => expect(lastFrame()).toContain('Delete "First run"?'));

    await press(stdin, 'y');
    await waitFor(() => expect(client.deleteRun).toHaveBeenCalledWith({ runId: 'run-1' }));
    expect(lastFrame()).not.toContain('First run');
    expect(lastFrame()).toContain('Second run');
  });

  it('cancels a pending delete with n, keeping the run in the list', async () => {
    const runs = [runMeta({ runId: 'run-1', title: 'First run' })];
    const client = mockClient({ listRuns: vi.fn().mockResolvedValue(runs) });
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/runs');
    await press(stdin, '\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Runs');
      expect(lastFrame()).toContain('First run');
    });

    await press(stdin, '\x04');
    await waitFor(() => expect(lastFrame()).toContain('Delete "First run"?'));

    await press(stdin, 'n');
    expect(lastFrame()).not.toContain('Delete "First run"?');
    expect(lastFrame()).toContain('First run');
    expect(client.deleteRun).not.toHaveBeenCalled();
  });

  it('shows an error and keeps the run when deleteRun rejects (e.g. run still active)', async () => {
    const runs = [runMeta({ runId: 'run-1', title: 'First run' })];
    const client = mockClient({
      listRuns: vi.fn().mockResolvedValue(runs),
      deleteRun: vi.fn().mockRejectedValue(new Error('Run run-1 is still active')),
    });
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/runs');
    await press(stdin, '\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Runs');
      expect(lastFrame()).toContain('First run');
    });

    await press(stdin, '\x04');
    await press(stdin, 'y');

    await waitFor(() =>
      expect(lastFrame()).toContain('Failed to delete run: Run run-1 is still active'),
    );
    expect(lastFrame()).toContain('First run');
  });

  it('goes back to the splash screen with escape when the runs filter is empty', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/runs');
    await press(stdin, '\r');
    await waitFor(() => expect(lastFrame()).toContain('No runs yet'));

    await press(stdin, '\x1b');
    expect(lastFrame()).not.toContain('No runs yet');
    expect(lastFrame()).toContain('Describe your task and give instructions');
  });

  it('shows the models hint with the configured Architect/Worker models', async () => {
    const client = mockClient();
    const { lastFrame } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await waitFor(() => expect(lastFrame()).toContain('Architect'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Worker');
    expect(frame).toContain('claude-opus-5');
    expect(frame).toContain('claude-sonnet-5');
  });

  it('opens a centered help modal on /help, without replacing the splash screen behind it', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/help');
    await press(stdin, '\r');

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Help');
    expect(frame).toContain('esc to close');
    expect(frame).toContain('/settings');
    expect(frame).toContain('/runs');
    expect(frame).toContain('█');
  });

  it('closes the help modal and returns to the splash on escape', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/help');
    await press(stdin, '\r');
    await waitFor(() => expect(lastFrame()).toContain('Help'));

    await press(stdin, '\x1b');
    expect(lastFrame()).not.toContain('Help');
    expect(lastFrame()).toContain('Describe your task and give instructions');
  });

  it('shows an error hint for an unrecognized command', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await tick();
    await type(stdin, '/nope');
    await press(stdin, '\r');

    expect(lastFrame()).toContain('Unknown command: /nope — try /help');
  });
});
