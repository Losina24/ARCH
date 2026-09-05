import type { RunMeta } from '@losina/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildConsultationPrompt,
  buildPlanPrompt,
  buildRefinePlanPrompt,
  buildReviewPrompt,
} from './prompts.js';

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
  repos: [] as string[],
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

  it('says nothing about repositories when there is only a single one', () => {
    const prompt = buildPlanPrompt(planInput);
    expect(prompt).not.toContain('Repositories available');
  });

  it('lists every discovered repo and instructs one repoRoot per task when there are several', () => {
    const prompt = buildPlanPrompt({
      ...planInput,
      repos: ['/workspace/service-a', '/workspace/service-b'],
    });
    expect(prompt).toContain('Repositories available');
    expect(prompt).toContain('/workspace/service-a');
    expect(prompt).toContain('/workspace/service-b');
  });

  it('instructs the architect to sequence a shared contract task before its consumers', () => {
    const prompt = buildPlanPrompt(planInput);
    expect(prompt).toContain('shared surface');
    expect(prompt).toContain('"dependsOn: []"');
    expect(prompt).toContain('does not own it');
  });

  it('still gives the existing dependsOn/scope decomposition guidance', () => {
    const prompt = buildPlanPrompt(planInput);
    expect(prompt).toContain('Every "id" must be unique');
    expect(prompt).toContain('Keep scopes disjoint between tasks');
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

  // Regression guard: buildRefinePlanPrompt used to dump the tasks-index schema without any of
  // the decomposition guidelines that come with it in buildPlanPrompt, silently losing this
  // guidance (including contract-first sequencing) the moment a plan got refined.
  it('still carries the contract-first and dependsOn/scope decomposition guidance', () => {
    const prompt = buildRefinePlanPrompt({ ...planInput, feedback: 'feedback' });
    expect(prompt).toContain('shared surface');
    expect(prompt).toContain('"dependsOn: []"');
    expect(prompt).toContain('does not own it');
    expect(prompt).toContain('Every "id" must be unique');
    expect(prompt).toContain('Keep scopes disjoint between tasks');
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

  it('says nothing about dependency scopes when there are none', () => {
    const prompt = buildReviewPrompt({
      taskId,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff',
      correctionFilePath: '/tmp/project/correction.md',
      workerSummary: 'done',
    });
    expect(prompt).not.toContain('own these paths');
  });

  it('warns the reviewer when the diff might touch a dependency-owned path', () => {
    const prompt = buildReviewPrompt({
      taskId,
      taskMarkdown: '# Task brief',
      correctionMarkdowns: [],
      gitDiff: 'diff',
      correctionFilePath: '/tmp/project/correction.md',
      workerSummary: 'done',
      dependencyScopes: ['src/job.ts'],
    });
    expect(prompt).toContain('own these paths');
    expect(prompt).toContain('src/job.ts');
    expect(prompt).toContain('that is a defect — request a correction');
  });
});

describe('buildConsultationPrompt', () => {
  const consultationInput = {
    taskId,
    taskMarkdown: '# Task brief',
    correctionMarkdowns: [],
    gitDiff: 'diff --git a/src/index.js b/src/index.js',
    workerSummary: 'Implemented add(a, b) in src/index.js.',
    failureReason: 'Automated checks kept failing after 3 retries.',
    failureKind: 'checks' as const,
    retriesSpent: 3,
    maxRetries: 3,
    consultationFilePath:
      '/home/user/.arch/projects/project-abc12345/runs/run-1/tasks/TASK-001.consultation.1.json',
  };

  it('names the stuck task, the failure classification/budget, and the consultation file path, ending with the CONSULTATION_READY sentinel', () => {
    const prompt = buildConsultationPrompt(consultationInput);

    expect(prompt).toContain('Stuck task: TASK-001');
    expect(prompt).toContain('# Task brief');
    expect(prompt).toContain('Automated checks kept failing after 3 retries.');
    expect(prompt).toContain('checks, after 3/3 correction attempts');
    expect(prompt).toContain(consultationInput.consultationFilePath);
    expect(prompt.trim().endsWith('CONSULTATION_READY')).toBe(true);
  });

  it('lists prior correction rounds in order when present', () => {
    const prompt = buildConsultationPrompt({
      ...consultationInput,
      correctionMarkdowns: ['fix the edge case', 'also add a docstring'],
    });

    expect(prompt).toContain('Prior correction rounds');
    const first = prompt.indexOf('fix the edge case');
    const second = prompt.indexOf('also add a docstring');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  it('falls back to placeholders when the diff and worker summary are empty', () => {
    const prompt = buildConsultationPrompt({
      ...consultationInput,
      gitDiff: '',
      workerSummary: '',
    });
    expect(prompt).toContain('(no changes were staged)');
    expect(prompt).toContain('(the worker left no explanation)');
  });

  it('instructs the Architect that the reply is relayed verbatim, never rewritten', () => {
    const prompt = buildConsultationPrompt(consultationInput);
    expect(prompt).toContain('passed VERBATIM to the Worker');
  });

  it('never mentions the unrelated dispatch markers other prompt kinds key off of', () => {
    const prompt = buildConsultationPrompt(consultationInput);
    expect(prompt).not.toContain('GRILLING_DONE');
    expect(prompt).not.toContain('Definition phase');
    expect(prompt).not.toContain('semantic review');
  });
});
