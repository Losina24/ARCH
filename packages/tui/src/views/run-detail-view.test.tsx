import type { ArchClient } from '@losina/daemon-client';
import type { AgentActivityEvent, ArchMeshEvent } from '@losina/ipc';
import type { AgentMeshConfig, RunMeta, RunPlan } from '@losina/schemas';
import type { Stdin } from 'ink-testing-library';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { RunDetailView } from './run-detail-view.js';

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

function mockClient(overrides: Partial<ArchClient> = {}): ArchClient {
  return {
    getRunPlan: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
    getRunEvents: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn().mockReturnValue(vi.fn()),
    ...overrides,
  } as unknown as ArchClient;
}

describe('RunDetailView', () => {
  it('keeps one terminal row free so animated frames do not trigger a full-terminal clear', async () => {
    const client = mockClient();
    const { lastFrame } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'implementation' })} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('/tmp/project'));
    // useTerminalRows falls back to 24 rows under ink-testing-library.
    expect((lastFrame() ?? '').split('\n')).toHaveLength(23);
  });

  it('lands on the planification tab showing the prompt, models, and a waiting status', async () => {
    const client = mockClient();
    const { lastFrame } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('› Overview ‹');
    expect(frame).toContain('Add a login page');
    expect(frame).toContain('Waiting for the Architect agent to start…');
  });

  it('keeps the feedback input typable so /abort always works, even if the Architect never responds', async () => {
    const aborted = runMeta({ phase: 'implementation' });
    const client = mockClient({ abortRun: vi.fn().mockResolvedValue(aborted) });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    expect(lastFrame()).toContain('Waiting for the Architect agent to start…');

    await type(stdin, '/abort');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Abort requested.'));
    expect(client.abortRun).toHaveBeenCalledWith({ runId: 'run-1' });
  });

  it('shows a clear error when fetching the plan fails, instead of staying silent', async () => {
    const client = mockClient({
      getRunPlan: vi.fn().mockRejectedValue(new Error('daemon unreachable')),
    });
    const { lastFrame } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Failed to load the plan: daemon unreachable'),
    );
  });

  it('shows the project brief and a ready status once the plan arrives', async () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief\n\nDo the thing.',
      tasksIndex: { tasks: [] },
    };
    const client = mockClient({ getRunPlan: vi.fn().mockResolvedValue(plan) });
    const { lastFrame } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Do the thing.'));
    expect(lastFrame()).toContain('Plan ready — approve it or send more feedback.');
  });

  it('switches tabs with the Tab key, moving the task graph into overview', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await tick();
    expect(lastFrame()).toContain('› Overview ‹');

    await press(stdin, '\t');
    expect(lastFrame()).toContain('› Monitor ‹');
    expect(lastFrame()).toContain('Task graph will appear here');

    await press(stdin, '\x1b[Z');
    expect(lastFrame()).toContain('› Overview ‹');
  });

  it('approves the run via the /approve command in the planification input', async () => {
    const approved = runMeta({ phase: 'implementation' });
    const plan: RunPlan = { projectMarkdown: '# Brief', tasksIndex: { tasks: [] } };
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      approveRun: vi.fn().mockResolvedValue(approved),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await type(stdin, '/approve');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));
    expect(client.approveRun).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(lastFrame()).not.toContain('Approved — implementation started.');
    expect(lastFrame()).toContain('x abort');
  });

  it('approves the run via "/ approve" — a stray space right after the slash still counts', async () => {
    const approved = runMeta({ phase: 'implementation' });
    const plan: RunPlan = { projectMarkdown: '# Brief', tasksIndex: { tasks: [] } };
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      approveRun: vi.fn().mockResolvedValue(approved),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await type(stdin, '/ approve');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(client.approveRun).toHaveBeenCalledWith({ runId: 'run-1' }));
  });

  it('aborts the run via the /abort command in the planification input', async () => {
    const aborted = runMeta({ phase: 'implementation' });
    const client = mockClient({ abortRun: vi.fn().mockResolvedValue(aborted) });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'implementation' })} onBack={vi.fn()} />,
    );

    await tick();
    await press(stdin, 'x');

    await vi.waitFor(() => expect(lastFrame()).toContain('Abort requested.'));
    expect(client.abortRun).toHaveBeenCalledWith({ runId: 'run-1' });
  });

  it('sends free-text feedback to the Architect from the planification tab', async () => {
    const refined = runMeta({ phase: 'definition' });
    const plan: RunPlan = { projectMarkdown: '# Brief', tasksIndex: { tasks: [] } };
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      refineRun: vi.fn().mockResolvedValue(refined),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    expect(lastFrame()).toContain('plan actions');

    await type(stdin, 'add oauth');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Feedback sent — revising the plan.'));
    expect(client.refineRun).toHaveBeenCalledWith({ runId: 'run-1', feedback: 'add oauth' });
  });

  it('shows that the Architect failed when a failed activity event arrives', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const client = mockClient({
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={vi.fn()} />,
    );

    await tick();
    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'architect-1',
      role: 'architect',
      state: 'failed',
    } as AgentActivityEvent as ArchMeshEvent);
    await tick();

    expect(lastFrame()).toContain('The Architect agent failed.');
  });

  it('stops waiting for the Architect even if refetching the plan fails after it completes', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const plan: RunPlan = { projectMarkdown: '# Brief', tasksIndex: { tasks: [] } };
    const client = mockClient({
      getRunPlan: vi
        .fn()
        .mockResolvedValueOnce(plan)
        .mockRejectedValueOnce(new Error('daemon unreachable')),
      refineRun: vi.fn().mockResolvedValue(runMeta({ phase: 'definition' })),
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));

    await type(stdin, 'add oauth');
    await press(stdin, '\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('Feedback sent — revising the plan.'));
    await vi.waitFor(() => expect(lastFrame()).toContain('Waiting for model'));

    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'architect-1',
      role: 'architect',
      state: 'completed',
    });

    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Failed to load the plan: daemon unreachable'),
    );
    expect(lastFrame()).not.toContain('Waiting for model');
    expect(lastFrame()).toContain('Ready');
  });

  it('clears the draft on escape instead of leaving, then leaves on a second escape', async () => {
    const onBack = vi.fn();
    const plan: RunPlan = { projectMarkdown: '# Brief', tasksIndex: { tasks: [] } };
    const client = mockClient({ getRunPlan: vi.fn().mockResolvedValue(plan) });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={onBack} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await type(stdin, 'draft');
    expect(lastFrame()).toContain('draft');

    await press(stdin, '\x1b');
    expect(onBack).not.toHaveBeenCalled();
    expect(lastFrame()).not.toContain('draft');

    await press(stdin, '\x1b');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('goes back on escape when the feedback input is not shown', async () => {
    const onBack = vi.fn();
    const client = mockClient();
    const { stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'implementation' })} onBack={onBack} />,
    );

    await tick();
    await press(stdin, '\x1b');

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('updates the phase and tasks panel from broadcast events', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const client = mockClient({
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'definition' })} onBack={vi.fn()} />,
    );

    await tick();
    handler?.({ type: 'run:status-changed', runId: 'run-1', phase: 'implementation' });
    await tick();

    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'worker-1',
      role: 'worker',
      state: 'thinking',
    });
    await tick();
    await press(stdin, '\t');
    await press(stdin, '\t');
    expect(lastFrame()).toContain('› Console ‹');
    expect(lastFrame()).toContain('Worker 1');
    expect(lastFrame()).toContain('Select an agent to access its terminal.');

    await press(stdin, '\x1b[Z');
    expect(lastFrame()).toContain('Worker 1:');
    expect(lastFrame()).toContain('Thinking…');
  });

  it('hydrates the Console agent list from persisted history on mount, with no live events at all', async () => {
    const client = mockClient({
      getRunEvents: vi.fn().mockResolvedValue([
        {
          event: {
            type: 'agent:activity',
            runId: 'run-1',
            agentId: 'worker-TASK-001',
            role: 'worker',
            state: 'thinking',
            taskId: 'TASK-001',
          },
          timestamp: 1000,
        },
      ]),
    });
    // A blocked run mounted fresh (e.g. navigating Home then back) never gets another live
    // event — mockClient's default onEvent handler is never invoked here, so this proves the
    // Agents/Console list comes from getRunEvents history alone, not from the live subscription.
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({ phase: 'blocked' })} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(client.getRunEvents).toHaveBeenCalledWith({ runId: 'run-1' }));

    await press(stdin, '\t');
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Console ‹'));
    expect(lastFrame()).toContain('Worker 1');
  });

  it('selects tasks with the arrow keys on the Monitor tab and highlights them', async () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'pending',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
          {
            id: 'TASK-002',
            title: 'Wire up the API',
            status: 'pending',
            dependsOn: [],
            file: 'task-2.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const client = mockClient({ getRunPlan: vi.fn().mockResolvedValue(plan) });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));

    expect(lastFrame()).not.toContain('❯TASK-001❯');

    await press(stdin, 's');
    expect(lastFrame()).toContain('❯TASK-001❯');

    await press(stdin, '\x1b[B');
    expect(lastFrame()).toContain('❯TASK-002❯');
    expect(lastFrame()).not.toContain('❯TASK-001❯');
  });

  it('updates a task card status live from task:status-changed events, without refetching the plan', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'pending',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));
    expect(lastFrame()).toContain('pending');

    handler?.({
      type: 'task:status-changed',
      runId: 'run-1',
      taskId: 'TASK-001',
      status: 'failed',
    });
    await tick();

    expect(client.getRunPlan).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain('failed');
    expect(lastFrame()).not.toContain('pending');
  });

  it('shows a red blocked-project message on the Monitor tab once a task fails', async () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'pending',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));
    expect(lastFrame()).not.toContain('go to Console to fix it');

    handler?.({
      type: 'task:status-changed',
      runId: 'run-1',
      taskId: 'TASK-001',
      status: 'failed',
    });
    await tick();

    expect(lastFrame()).toContain('Project blocked by a failed task — go to Console to fix it.');

    await press(stdin, '\t');
    expect(lastFrame()).not.toContain('go to Console to fix it');
  });

  it('shows a blue waiting-on-you message on the Monitor tab once a task needs a human', async () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'pending',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));
    expect(lastFrame()).not.toContain('go to Console to help it');

    handler?.({
      type: 'task:status-changed',
      runId: 'run-1',
      taskId: 'TASK-001',
      status: 'awaiting_human',
    });
    await tick();

    expect(lastFrame()).toContain('A task is waiting on you — go to Console to help it.');

    await press(stdin, '\t');
    expect(lastFrame()).not.toContain('go to Console to help it');
  });

  it('opens a task detail page on Enter and returns to the diagram on Esc', async () => {
    const onBack = vi.fn();
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'pending',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      getTaskFile: vi.fn().mockResolvedValue('# Build the login form\n\nDo the thing.'),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={onBack} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));

    await press(stdin, 's');
    await press(stdin, '\r');
    expect(client.getTaskFile).toHaveBeenCalledWith({ runId: 'run-1', file: 'task-1.md' });
    await vi.waitFor(() => expect(lastFrame()).toContain('Do the thing.'));
    expect(lastFrame()).toContain('› Monitor ‹');

    await press(stdin, '\x1b');
    await vi.waitFor(() => expect(lastFrame()).not.toContain('Do the thing.'));
    expect(lastFrame()).toContain('❯TASK-001❯');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('selects an agent with the arrow keys on the Console tab and highlights it', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const client = mockClient({
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await tick();
    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      state: 'thinking',
      taskId: 'TASK-001',
    });
    await tick();

    await press(stdin, '\t');
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Console ‹'));

    await press(stdin, 's');
    expect(lastFrame()).toContain('❯ Architect');

    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    expect(lastFrame()).toContain('❯ Worker 1');

    await press(stdin, '\r');
    expect(lastFrame()).toContain('❯ Worker 1');
    expect(lastFrame()).not.toContain('Select an agent to access its terminal.');
    expect(lastFrame()).toContain('Message this agent…');
  });

  it('opens an agent Console already scrolled to its latest message', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const client = mockClient({
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await tick();
    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      state: 'thinking',
      taskId: 'TASK-001',
    });
    for (let i = 0; i < 10; i++) {
      handler?.({
        type: 'agent:message',
        runId: 'run-1',
        agentId: 'worker-TASK-001',
        role: 'worker',
        taskId: 'TASK-001',
        text: `message-${i}`,
      });
    }
    await tick();

    await press(stdin, '\t');
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Console ‹'));

    await press(stdin, 's');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('message-9'));
    expect(lastFrame()).not.toContain('message-0');

    handler?.({
      type: 'agent:message',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      taskId: 'TASK-001',
      text: 'message-10',
    });
    await vi.waitFor(() => expect(lastFrame()).toContain('message-10'));
    expect(lastFrame()).toContain('❯ Worker 1');

    await press(stdin, '\x1b[5~');
    handler?.({
      type: 'agent:message',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      taskId: 'TASK-001',
      text: 'message-11',
    });
    await tick();
    expect(lastFrame()).not.toContain('message-11');
    expect(lastFrame()).toContain('❯ Worker 1');

    await press(stdin, '\x1b[6~');
    await press(stdin, '\x1b[6~');
    handler?.({
      type: 'agent:message',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      taskId: 'TASK-001',
      text: 'message-12',
    });
    await vi.waitFor(() => expect(lastFrame()).toContain('message-12'));
  });

  it('resumes a failed worker with a prompt from the Console tab', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'failed',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 1,
            checks: [],
          },
        ],
      },
    };
    const resumed = runMeta({});
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      retryTask: vi.fn().mockResolvedValue(resumed),
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      state: 'failed',
      taskId: 'TASK-001',
    });
    await tick();

    await press(stdin, '\t');
    await press(stdin, '\t');
    await press(stdin, 's');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    await type(stdin, 'Try the v2 approach.');
    await press(stdin, '\r');

    await vi.waitFor(() =>
      expect(client.retryTask).toHaveBeenCalledWith({
        runId: 'run-1',
        taskId: 'TASK-001',
        message: 'Try the v2 approach.',
      }),
    );
    await vi.waitFor(() => expect(lastFrame()).toContain('Message sent — resuming the agent.'));
  });

  it('rejects a prompt sent to an agent that has no failed task to resume', async () => {
    const client = mockClient({ retryTask: vi.fn() });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await tick();
    await press(stdin, '\t');
    await press(stdin, '\t');
    await press(stdin, 's');
    await press(stdin, '\r');

    await type(stdin, 'Try again.');
    await press(stdin, '\r');

    await vi.waitFor(() =>
      expect(lastFrame()).toContain(
        'Only a failed or awaiting-help worker agent can be resumed with a message.',
      ),
    );
    expect(client.retryTask).not.toHaveBeenCalled();
  });

  it('resumes an awaiting_human worker with a prompt from the Console tab', async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'awaiting_human',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 1,
            checks: [],
          },
        ],
      },
    };
    const resumed = runMeta({});
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      retryTask: vi.fn().mockResolvedValue(resumed),
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      state: 'idle-waiting',
      taskId: 'TASK-001',
    });
    await tick();

    await press(stdin, '\t');
    await press(stdin, '\t');
    await press(stdin, 's');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    await type(stdin, 'Grant the permission and retry.');
    await press(stdin, '\r');

    await vi.waitFor(() =>
      expect(client.retryTask).toHaveBeenCalledWith({
        runId: 'run-1',
        taskId: 'TASK-001',
        message: 'Grant the permission and retry.',
      }),
    );
    await vi.waitFor(() => expect(lastFrame()).toContain('Message sent — resuming the agent.'));
  });

  it('expands the task Console to full width with c, hiding Task definition, then collapses back', async () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'pending',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      getTaskFile: vi.fn().mockResolvedValue('# Build the login form\n\nDo the thing.'),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));
    await press(stdin, 's');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Do the thing.'));
    expect(lastFrame()).toContain('Console');
    expect(lastFrame()).toContain('Task definition');

    await press(stdin, 'c');
    expect(lastFrame()).toContain('Console');
    expect(lastFrame()).not.toContain('Task definition');
    expect(lastFrame()).not.toContain('Do the thing.');

    await press(stdin, 'c');
    await vi.waitFor(() => expect(lastFrame()).toContain('Task definition'));
    expect(lastFrame()).toContain('Do the thing.');
  });

  it('does not show the task-console message input for a task that is not failed or awaiting_human', async () => {
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'pending',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 0,
            checks: [],
          },
        ],
      },
    };
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      getTaskFile: vi.fn().mockResolvedValue('# Build the login form\n\nDo the thing.'),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));
    await press(stdin, 's');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Do the thing.'));
    expect(lastFrame()).not.toContain('Message this agent…');
  });

  it("shows a human prompt sent from the task console in both the task page and the agent's Console tab", async () => {
    let handler: ((event: ArchMeshEvent) => void) | undefined;
    const plan: RunPlan = {
      projectMarkdown: '# Brief',
      tasksIndex: {
        tasks: [
          {
            id: 'TASK-001',
            title: 'Build the login form',
            status: 'failed',
            dependsOn: [],
            file: 'task-1.md',
            correctionFiles: [],
            retries: 1,
            checks: [],
          },
        ],
      },
    };
    const resumed = runMeta({});
    const client = mockClient({
      getRunPlan: vi.fn().mockResolvedValue(plan),
      getTaskFile: vi.fn().mockResolvedValue('# Build the login form\n\nDo the thing.'),
      retryTask: vi.fn().mockResolvedValue(resumed),
      onEvent: vi.fn((eventHandler: (event: ArchMeshEvent) => void) => {
        handler = eventHandler;
        return vi.fn();
      }),
    });
    const { lastFrame, stdin } = render(
      <RunDetailView client={client} run={runMeta({})} onBack={vi.fn()} />,
    );

    await vi.waitFor(() => expect(lastFrame()).toContain('Plan ready'));
    handler?.({
      type: 'agent:activity',
      runId: 'run-1',
      agentId: 'worker-TASK-001',
      role: 'worker',
      state: 'failed',
      taskId: 'TASK-001',
    });
    await tick();

    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Monitor ‹'));
    await press(stdin, 's');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Message this agent…'));
    await type(stdin, 'Try the v2 approach.');
    await press(stdin, '\r');

    await vi.waitFor(() =>
      expect(client.retryTask).toHaveBeenCalledWith({
        runId: 'run-1',
        taskId: 'TASK-001',
        message: 'Try the v2 approach.',
      }),
    );

    handler?.({
      type: 'human:prompt-sent',
      runId: 'run-1',
      taskId: 'TASK-001',
      agentId: 'worker-TASK-001',
      text: 'Try the v2 approach.',
    });
    await tick();
    expect(lastFrame()).toContain('Try the v2 approach.');

    await press(stdin, '\x1b');
    await vi.waitFor(() => expect(lastFrame()).not.toContain('Do the thing.'));
    await press(stdin, '\t');
    await vi.waitFor(() => expect(lastFrame()).toContain('› Console ‹'));
    await press(stdin, 's');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Try the v2 approach.'));
  });
});
