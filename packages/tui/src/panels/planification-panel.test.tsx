import type { AgentActivityEvent } from '@losina/ipc';
import type { AgentMeshConfig, RunMeta, RunPlan } from '@losina/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { PlanificationPanel } from './planification-panel.js';

const run: RunMeta = {
  runId: 'run-1',
  title: 'Add login page',
  prompt: 'Add a login page with email/password',
  cwd: '/tmp/project',
  phase: 'definition',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

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

function architectEvent(
  state: AgentActivityEvent['state'],
  overrides: Partial<AgentActivityEvent> = {},
): AgentActivityEvent {
  return {
    type: 'agent:activity',
    runId: 'run-1',
    agentId: 'architect-1',
    role: 'architect',
    state,
    ...overrides,
  };
}

describe('PlanificationPanel', () => {
  it('renders the prompt and the chosen models', () => {
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={undefined}
        width={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Add a login page');
    expect(frame).toContain('email/password');
    expect(frame).toContain('claude-opus-5');
    expect(frame).toContain('claude-sonnet-5');
  });

  it('shows a waiting message before the Architect has produced any activity', () => {
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={undefined}
        width={80}
      />,
    );
    expect(lastFrame()).toContain('Waiting for the Architect agent to start…');
  });

  it('reflects the latest architect activity state', () => {
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={architectEvent('thinking')}
        width={80}
      />,
    );
    expect(lastFrame()).toContain('Architect is thinking…');
  });

  it('shows the Architect live activity and file when detailed progress is available', () => {
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={architectEvent('using-tool', {
          detail: 'Running tests',
          tool: 'Shell',
          file: 'src/auth.ts',
        })}
        width={100}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Architect · Running tests');
    expect(frame).toContain('src/auth.ts');
    expect(frame).not.toContain('Architect is thinking');
  });

  it('shows a clear failure message when the Architect fails, instead of a bare placeholder', () => {
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={architectEvent('failed')}
        width={80}
      />,
    );
    expect(lastFrame()).toContain('The Architect agent failed.');
  });

  it('surfaces the plan-fetch error instead of staying silent', () => {
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={null}
        planError="daemon unreachable"
        config={config}
        latestArchitectEvent={undefined}
        width={80}
      />,
    );
    expect(lastFrame()).toContain('Failed to load the plan: daemon unreachable');
  });

  it('renders the project brief and a ready status once the plan is available', () => {
    const plan: RunPlan = {
      projectMarkdown: '# Project brief\n\nDo the thing.',
      tasksIndex: { tasks: [] },
    };
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={plan}
        planError={null}
        config={config}
        latestArchitectEvent={architectEvent('completed')}
        width={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Do the thing.');
    expect(frame).toContain('Plan ready — approve it or send more feedback.');
  });

  it('lists the task titles once the plan includes tasks', () => {
    const plan: RunPlan = {
      projectMarkdown: '# Project brief',
      tasksIndex: {
        tasks: [
          {
            id: 'task-1',
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
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={plan}
        planError={null}
        config={config}
        latestArchitectEvent={architectEvent('completed')}
        width={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('task-1');
    expect(frame).toContain('Build the');
    expect(frame).toContain('•');
  });

  it('truncates a long prompt to 10 lines and appends an ellipsis, instead of blowing up the layout', () => {
    const longRun: RunMeta = {
      ...run,
      prompt: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'),
    };
    const { lastFrame } = render(
      <PlanificationPanel
        run={longRun}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={undefined}
        width={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line 1');
    expect(frame).toContain('line 10');
    expect(frame).not.toContain('line 11');
    expect(frame).not.toContain('line 20');
    expect(frame).toContain('│ …');
  });

  it('does not show an ellipsis when the prompt fits within 10 lines', () => {
    const { lastFrame } = render(
      <PlanificationPanel
        run={run}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={undefined}
        width={80}
      />,
    );
    expect(lastFrame()).not.toContain('│ …');
  });

  it('shows the finished status once planning is done', () => {
    const doneRun: RunMeta = { ...run, phase: 'implementation' };
    const { lastFrame } = render(
      <PlanificationPanel
        run={doneRun}
        plan={null}
        planError={null}
        config={config}
        latestArchitectEvent={undefined}
        width={80}
      />,
    );
    expect(lastFrame()).toContain('Planning finished.');
  });
});
