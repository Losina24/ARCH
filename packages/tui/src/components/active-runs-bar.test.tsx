import type { RunMeta } from '@losina/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ActiveRunsBar } from './active-runs-bar.js';

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

describe('ActiveRunsBar', () => {
  it('renders nothing when there are no active runs', () => {
    const { lastFrame } = render(<ActiveRunsBar runs={[]} width={80} />);
    expect(lastFrame()).toBe('');
  });

  it('lists each active run with its phase', () => {
    const runs = [
      runMeta({ runId: 'run-1', title: 'Add login page', phase: 'implementation' }),
      runMeta({ runId: 'run-2', title: 'Write docs', phase: 'grilling' }),
    ];
    const { lastFrame } = render(<ActiveRunsBar runs={runs} width={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[implementation] Add login page');
    expect(frame).toContain('[grilling] Write docs');
  });

  it('truncates the list and shows a "+N more" suffix once it would overflow the width', () => {
    const runs = Array.from({ length: 10 }, (_, index) =>
      runMeta({
        runId: `run-${index}`,
        title: `A moderately long run title number ${index}`,
        phase: 'implementation',
      }),
    );
    const { lastFrame } = render(<ActiveRunsBar runs={runs} width={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('more');
    expect(frame.length).toBeLessThanOrEqual(80 + 10);
  });
});
