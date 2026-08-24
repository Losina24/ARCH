import type { ArchClient } from '@losina/daemon-client';
import type { AgentMeshConfig, RunMeta } from '@losina/schemas';
import type { Stdin } from 'ink-testing-library';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { HomeView } from './home-view.js';

const config: AgentMeshConfig = {
  models: {
    architectModel: 'claude-opus-5',
    tlModel: 'claude-sonnet-5',
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

    await vi.waitFor(() => expect(onOpenRun).toHaveBeenCalledWith(created));
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

    await vi.waitFor(() => expect(lastFrame()).toContain('Settings'));
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
    await vi.waitFor(() => expect(lastFrame()).toContain('Settings'));

    await press(stdin, '\x1b');
    await vi.waitFor(() => expect(lastFrame()).not.toContain('Settings'));
    expect(lastFrame()).toContain('Describe your task and give instructions');
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

    await vi.waitFor(() => expect(lastFrame()).toContain('First run'));
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
    await vi.waitFor(() => expect(lastFrame()).toContain('First run'));

    await type(stdin, 'sec');
    await vi.waitFor(() => expect(lastFrame()).not.toContain('First run'));
    expect(lastFrame()).toContain('Second run');

    await press(stdin, '\x1b');
    await vi.waitFor(() => expect(lastFrame()).toContain('First run'));
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
    await vi.waitFor(() => expect(lastFrame()).toContain('First run'));

    await press(stdin, '\x04');
    expect(lastFrame()).toContain('Delete "First run"?');

    await press(stdin, 'y');
    await vi.waitFor(() => expect(client.deleteRun).toHaveBeenCalledWith({ runId: 'run-1' }));
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
    await vi.waitFor(() => expect(lastFrame()).toContain('First run'));

    await press(stdin, '\x04');
    expect(lastFrame()).toContain('Delete "First run"?');

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
    await vi.waitFor(() => expect(lastFrame()).toContain('First run'));

    await press(stdin, '\x04');
    await press(stdin, 'y');

    await vi.waitFor(() =>
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
    await vi.waitFor(() => expect(lastFrame()).toContain('No runs yet'));

    await press(stdin, '\x1b');
    expect(lastFrame()).not.toContain('No runs yet');
    expect(lastFrame()).toContain('Describe your task and give instructions');
  });

  it('shows the models hint with the configured Architect/TL/Worker models', async () => {
    const client = mockClient();
    const { lastFrame } = render(
      <HomeView client={client} cwd="/tmp/project" bootAnimationMs={0} onOpenRun={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Architect'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TL');
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
    await vi.waitFor(() => expect(lastFrame()).toContain('Help'));

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
