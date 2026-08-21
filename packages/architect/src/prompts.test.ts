import type { RunMeta } from '@arch/schemas';
import { describe, expect, it } from 'vitest';
import { buildPlanPrompt, buildRefinePlanPrompt, buildReviewPrompt } from './prompts.js';

const run: RunMeta = {
  runId: 'run-1',
  title: 'Add add(a, b)',
  prompt: 'Add a function that sums two numbers',
  cwd: '/tmp/project',
  phase: 'definition',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
};

const planInput = {
  run,
  projectMarkdownPath: '/home/user/.arch/projects/project-abc12345/runs/run-1/project.md',
  tasksIndexPath: '/home/user/.arch/projects/project-abc12345/runs/run-1/tasks-index.yaml',
  tasksDirPath: '/home/user/.arch/projects/project-abc12345/runs/run-1/tasks',
};

const taskId = 'TASK-001';

describe('buildPlanPrompt', () => {
  it('embeds the user prompt and every output path, and ends with the PLAN_READY sentinel', () => {
    const prompt = buildPlanPrompt(planInput);
    expect(prompt).toContain(run.prompt);
    expect(prompt).toContain(planInput.projectMarkdownPath);
    expect(prompt).toContain(planInput.tasksIndexPath);
    expect(prompt).toContain(planInput.tasksDirPath);
    expect(prompt.trim().endsWith('PLAN_READY')).toBe(true);
  });
});

describe('buildRefinePlanPrompt', () => {
  it('embeds the feedback and still ends with PLAN_READY', () => {
    const prompt = buildRefinePlanPrompt({ ...planInput, feedback: 'Split task 2 in two' });
    expect(prompt).toContain('Split task 2 in two');
    expect(prompt.trim().endsWith('PLAN_READY')).toBe(true);
  });

  it('instructs the architect to keep still-valid task ids unchanged', () => {
    const prompt = buildRefinePlanPrompt({ ...planInput, feedback: 'feedback' });
    expect(prompt).toContain('Keep the ids of tasks that are still valid');
    expect(prompt).toContain('unchanged (so any existing references keep working)');
  });
});

describe('buildReviewPrompt', () => {
  it('embeds the task brief, diff and correction file path with no prior corrections', () => {
    const prompt = buildReviewPrompt({
      taskId,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff --git a/src/index.js b/src/index.js',
      correctionFilePath:
        '/home/user/.arch/projects/project-abc12345/runs/run-1/tasks/TASK-001.correction-1.md',
      workerSummary: 'Implemented add(a, b) in src/index.js.',
    });

    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('diff --git a/src/index.js b/src/index.js');
    expect(prompt).toContain(
      '/home/user/.arch/projects/project-abc12345/runs/run-1/tasks/TASK-001.correction-1.md',
    );
    expect(prompt).toContain('Implemented add(a, b) in src/index.js.');
    expect(prompt).not.toContain('Prior correction rounds');
  });

  it('lists prior correction rounds in order when present', () => {
    const prompt = buildReviewPrompt({
      taskId,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: ['fix the edge case', 'also add a docstring'],
      gitDiff: 'diff',
      correctionFilePath: '/tmp/project/correction.md',
      workerSummary: 'Fixed the edge case and added a docstring.',
    });

    expect(prompt).toContain('Prior correction rounds');
    const first = prompt.indexOf('fix the edge case');
    const second = prompt.indexOf('also add a docstring');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  it('falls back to a placeholder when the diff is empty', () => {
    const prompt = buildReviewPrompt({
      taskId,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: '',
      correctionFilePath: '/tmp/project/correction.md',
      workerSummary: 'No changes were needed.',
    });
    expect(prompt).toContain('(no changes were staged)');
  });

  it('falls back to a placeholder when the worker left no summary', () => {
    const prompt = buildReviewPrompt({
      taskId,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff',
      correctionFilePath: '/tmp/project/correction.md',
      workerSummary: '',
    });
    expect(prompt).toContain('(the worker left no explanation)');
  });
});
