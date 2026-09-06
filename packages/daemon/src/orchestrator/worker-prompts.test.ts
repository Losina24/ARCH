import { describe, expect, it } from 'vitest';
import { buildWorkerPrompt } from './worker-prompts.js';

describe('buildWorkerPrompt', () => {
  it('embeds the task brief when there is no correction', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief\n\nAdd add(a, b).',
    });
    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('Add add(a, b).');
    expect(prompt).not.toContain('Requested corrections');
  });

  it('echoes the task id as a self-identification line', () => {
    const prompt = buildWorkerPrompt({ taskId: 'TASK-042', taskMarkdown: '# Task brief' });
    expect(prompt).toContain('Task under implementation: TASK-042');
  });

  it('embeds both the original brief and the correction when one is given, defaulting to review attribution', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief',
      correctionMarkdown: 'Handle the negative-number case too.',
    });
    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('Handle the negative-number case too.');
    expect(prompt).toContain('Requested corrections');
    expect(prompt).toContain('The Architect reviewed your previous implementation');
  });

  it('attributes the correction to the automated checks when the source is checks', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief',
      correctionMarkdown: 'The build check failed.',
      correctionSource: 'checks',
    });
    expect(prompt).toContain("This task's automated checks were run");
    expect(prompt).not.toContain('The Architect');
    expect(prompt).not.toContain('Team Lead');
  });

  it('attributes the correction to an automated scope check when the source is scope', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief',
      correctionMarkdown: 'You changed a file outside your scope.',
      correctionSource: 'scope',
    });
    expect(prompt).toContain('An automated scope check found file changes outside');
    expect(prompt).not.toContain('The Architect');
    expect(prompt).not.toContain('Team Lead');
  });

  it('embeds a human note when retrying with no correction', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief',
      humanMessage: 'Try using the v2 API instead.',
    });
    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('Try using the v2 API instead.');
    expect(prompt).toContain('left this note for you');
  });

  it('ignores the human note once a correction is in progress', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief',
      correctionMarkdown: 'Handle the negative-number case too.',
      humanMessage: 'Try using the v2 API instead.',
    });
    expect(prompt).not.toContain('Try using the v2 API instead.');
    expect(prompt).not.toContain('left this note for you');
  });

  it('says nothing about checks when the task has none', () => {
    const prompt = buildWorkerPrompt({ taskId: 'TASK-001', taskMarkdown: '# Task brief' });
    expect(prompt).not.toContain('validated by running');
  });

  it('embeds the exact check commands so the worker can run them itself before finishing', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief',
      checks: [{ name: 'build', command: 'pnpm', args: ['--filter', 'some-app', 'build'] }],
    });
    expect(prompt).toContain('- build: pnpm --filter some-app build');
    expect(prompt).toContain('mistake in this task');
  });

  it('embeds check commands in a correction prompt too', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-001',
      taskMarkdown: '# Task brief',
      correctionMarkdown: 'The build check failed.',
      correctionSource: 'checks',
      checks: [{ name: 'test', command: 'pnpm', args: ['test'] }],
    });
    expect(prompt).toContain('- test: pnpm test');
  });

  it('says nothing about dependencies when there are none', () => {
    const prompt = buildWorkerPrompt({ taskId: 'TASK-002', taskMarkdown: '# Task brief' });
    expect(prompt).not.toContain('depends on work other tasks already completed');
  });

  it('lists each dependency with its id, title, scope, and a do-not-redefine instruction', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-002',
      taskMarkdown: '# Task brief',
      dependencies: [
        {
          id: 'TASK-001',
          title: 'Define the shared Job type',
          scope: ['packages/schemas/src/job.ts'],
        },
      ],
    });
    expect(prompt).toContain('depends on work other tasks already completed');
    expect(prompt).toContain('TASK-001');
    expect(prompt).toContain('Define the shared Job type');
    expect(prompt).toContain('packages/schemas/src/job.ts');
    expect(prompt).toContain('Do not redefine, duplicate or');
  });

  it('includes a dependency summary only when provided (the empty-scope fallback case)', () => {
    const withSummary = buildWorkerPrompt({
      taskId: 'TASK-002',
      taskMarkdown: '# Task brief',
      dependencies: [{ id: 'TASK-001', title: 'Foundations', scope: [], summary: 'Sets up X.' }],
    });
    expect(withSummary).toContain('Sets up X.');

    const withoutSummary = buildWorkerPrompt({
      taskId: 'TASK-002',
      taskMarkdown: '# Task brief',
      dependencies: [{ id: 'TASK-001', title: 'Foundations', scope: ['src/x.ts'] }],
    });
    expect(withoutSummary).not.toContain('Sets up X.');
  });

  it('lists dependencies in a correction prompt too', () => {
    const prompt = buildWorkerPrompt({
      taskId: 'TASK-002',
      taskMarkdown: '# Task brief',
      correctionMarkdown: 'Fix the edge case.',
      dependencies: [{ id: 'TASK-001', title: 'Shared types', scope: ['src/types.ts'] }],
    });
    expect(prompt).toContain('depends on work other tasks already completed');
    expect(prompt).toContain('TASK-001');
  });
});
