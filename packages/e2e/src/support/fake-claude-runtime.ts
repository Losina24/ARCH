import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { RunHeadlessOptions, RunHeadlessResult } from '@losina/claude-runtime';
import { getArchPaths } from '@losina/config';
import type { CheckDefinition } from '@losina/schemas';
import { stringify } from 'yaml';

export interface PlanTaskSpec {
  id: string;
  title: string;
  dependsOn?: string[];
  checks?: CheckDefinition[];
  markdown?: string;
  scope?: string[];
  repoRoot?: string;
}

export interface PlanSpec {
  projectMarkdown: string;
  tasks: PlanTaskSpec[];
}

/** A returned string becomes this dispatch's `summary` (the fake worker's "explanation"); void defaults to 'done'. */
export type WorkerHandler = (
  options: RunHeadlessOptions,
  // biome-ignore lint/suspicious/noConfusingVoidType: sync/async handlers may legitimately return nothing
) => Promise<string | undefined> | void | string;
export type ReviewVerdictSpec = 'approve' | { correctionMarkdown: string };
export type ConsultationVerdictSpec =
  | { question: string; recommendation: string }
  | { crash: string };

// Paths embedded in real prompts come from `path.join`, so on Windows they're
// backslash-separated (e.g. "...\runs\<id>\project.md") rather than the POSIX form.
const RUN_ID_PATTERN = /[/\\]runs[/\\]([^/\\]+)[/\\]/;
const REVIEW_TASK_ID_PATTERN = /implementing task\s+"([^"]+)"/;
const CORRECTION_FILE_PATTERN = /exactly this path: "([^"]+)"/;
const CONSULTATION_TASK_ID_PATTERN = /Stuck task: (\S+)/;
const CONSULTATION_FILE_PATTERN = /Write your question to exactly this path: "([^"]+)"/;

function extractRunId(prompt: string): string {
  const match = RUN_ID_PATTERN.exec(prompt);
  if (!match) {
    throw new Error(`FakeClaudeRuntime: could not find a run id in prompt:\n${prompt}`);
  }
  return match[1];
}

function extractReviewTaskId(prompt: string): string {
  const match = REVIEW_TASK_ID_PATTERN.exec(prompt);
  if (!match) {
    throw new Error(`FakeClaudeRuntime: could not find a task id in review prompt:\n${prompt}`);
  }
  return match[1];
}

function extractCorrectionFilePath(prompt: string): string {
  const match = CORRECTION_FILE_PATTERN.exec(prompt);
  if (!match) {
    throw new Error(
      `FakeClaudeRuntime: could not find a correction file path in prompt:\n${prompt}`,
    );
  }
  return match[1];
}

/**
 * Stands in for the real `claude -p` CLI in e2e tests. Detects which agent issued a given
 * `runClaudeHeadless` call from fixed markers in the (fully deterministic) prompts this repo
 * generates, and fulfils it from test-configured queues instead of spawning a real CLI process.
 */
export class FakeClaudeRuntime {
  private readonly planQueue: PlanSpec[] = [];
  private readonly workerQueues = new Map<string, WorkerHandler[]>();
  private readonly reviewQueues = new Map<string, ReviewVerdictSpec[]>();
  private readonly workerCalls = new Map<string, number>();
  private readonly reviewPrompts = new Map<string, string>();
  private readonly consultationQueues = new Map<string, ConsultationVerdictSpec[]>();
  private readonly consultationCalls = new Map<string, number>();
  private readonly consultationPrompts = new Map<string, string>();

  queuePlan(spec: PlanSpec): void {
    this.planQueue.push(spec);
  }

  lastReviewPrompt(taskId: string): string | undefined {
    return this.reviewPrompts.get(taskId);
  }

  queueWorker(taskId: string, handler: WorkerHandler): void {
    const queue = this.workerQueues.get(taskId) ?? [];
    queue.push(handler);
    this.workerQueues.set(taskId, queue);
  }

  queueReview(taskId: string, verdict: ReviewVerdictSpec): void {
    const queue = this.reviewQueues.get(taskId) ?? [];
    queue.push(verdict);
    this.reviewQueues.set(taskId, queue);
  }

  workerCallCount(taskId: string): number {
    return this.workerCalls.get(taskId) ?? 0;
  }

  queueConsultation(taskId: string, spec: ConsultationVerdictSpec): void {
    const queue = this.consultationQueues.get(taskId) ?? [];
    queue.push(spec);
    this.consultationQueues.set(taskId, queue);
  }

  consultationCallCount(taskId: string): number {
    return this.consultationCalls.get(taskId) ?? 0;
  }

  lastConsultationPrompt(taskId: string): string | undefined {
    return this.consultationPrompts.get(taskId);
  }

  async handle(options: RunHeadlessOptions): Promise<RunHeadlessResult> {
    const sessionId = randomUUID();

    // Skip the grilling phase in e2e tests — they weren't written with a clarifying Q&A round in mind.
    if (options.prompt.includes('GRILLING_DONE')) {
      return { sessionId, output: 'GRILLING_DONE' };
    }

    if (options.prompt.includes('Definition phase')) {
      await this.writePlan(options);
      return { sessionId, output: 'PLAN_READY' };
    }

    if (options.prompt.includes('semantic review')) {
      const output = await this.writeReview(options);
      return { sessionId, output };
    }

    if (options.prompt.includes('CONSULTATION_READY')) {
      const output = await this.writeConsultation(options);
      return { sessionId, output };
    }

    const output = await this.runWorker(options);
    return { sessionId, output };
  }

  private async writePlan(options: RunHeadlessOptions): Promise<void> {
    const spec = this.planQueue.shift();
    if (!spec) {
      throw new Error('FakeClaudeRuntime: no queued plan for this Definition-phase call');
    }

    const runId = extractRunId(options.prompt);
    const { archDir } = getArchPaths(options.cwd);
    const runDir = join(archDir, 'runs', runId);
    const tasksDir = join(runDir, 'tasks');
    await mkdir(tasksDir, { recursive: true });

    await writeFile(join(runDir, 'project.md'), spec.projectMarkdown, 'utf-8');

    const tasks = spec.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: 'pending',
      dependsOn: task.dependsOn ?? [],
      file: `tasks/${task.id}.md`,
      correctionFiles: [],
      retries: 0,
      checks: task.checks ?? [],
      scope: task.scope ?? [],
      ...(task.repoRoot ? { repoRoot: task.repoRoot } : {}),
    }));
    await writeFile(join(runDir, 'tasks-index.yaml'), stringify({ tasks }), 'utf-8');

    for (const task of spec.tasks) {
      const markdown =
        task.markdown ?? `# ${task.title}\n\nDefinition of Done: implement "${task.id}".\n`;
      await writeFile(join(tasksDir, `${task.id}.md`), markdown, 'utf-8');
    }
  }

  private resolveWorkerTaskId(options: RunHeadlessOptions): string {
    const cwdTaskId = basename(options.cwd);
    if (this.workerQueues.has(cwdTaskId)) return cwdTaskId;

    for (const candidateId of this.workerQueues.keys()) {
      if (options.prompt.includes(candidateId)) return candidateId;
    }
    return cwdTaskId;
  }

  private async runWorker(options: RunHeadlessOptions): Promise<string> {
    const taskId = this.resolveWorkerTaskId(options);
    this.workerCalls.set(taskId, (this.workerCalls.get(taskId) ?? 0) + 1);

    const handler = this.workerQueues.get(taskId)?.shift();
    const result = handler ? await handler(options) : undefined;
    return result ?? 'done';
  }

  private async writeReview(options: RunHeadlessOptions): Promise<string> {
    const taskId = extractReviewTaskId(options.prompt);
    this.reviewPrompts.set(taskId, options.prompt);
    const verdict = this.reviewQueues.get(taskId)?.shift() ?? 'approve';
    if (verdict === 'approve') return 'APPROVED';

    // correctionFilePath is already an absolute path under the run's archDir (see
    // review-task.ts) — the real Claude CLI writes there directly, so this must too instead
    // of joining it onto options.cwd (the repo root), which would produce a bogus nested path.
    const correctionFilePath = extractCorrectionFilePath(options.prompt);
    await writeFile(correctionFilePath, verdict.correctionMarkdown, 'utf-8');
    return 'NEEDS_CORRECTION';
  }

  private async writeConsultation(options: RunHeadlessOptions): Promise<string> {
    const match = CONSULTATION_TASK_ID_PATTERN.exec(options.prompt);
    if (!match) {
      throw new Error(
        `FakeClaudeRuntime: could not find a task id in consultation prompt:\n${options.prompt}`,
      );
    }
    const taskId = match[1];
    this.consultationPrompts.set(taskId, options.prompt);
    this.consultationCalls.set(taskId, (this.consultationCalls.get(taskId) ?? 0) + 1);

    const spec = this.consultationQueues.get(taskId)?.shift();
    // No queued spec: the Architect chose not to ask anything — write nothing, same as a real
    // "no question" turn.
    if (!spec) return 'CONSULTATION_READY';
    if ('crash' in spec) throw new Error(spec.crash);

    const fileMatch = CONSULTATION_FILE_PATTERN.exec(options.prompt);
    if (!fileMatch) {
      throw new Error(
        `FakeClaudeRuntime: could not find a consultation file path in prompt:\n${options.prompt}`,
      );
    }
    await writeFile(
      fileMatch[1],
      JSON.stringify({ question: spec.question, recommendation: spec.recommendation }),
      'utf-8',
    );
    return 'CONSULTATION_READY';
  }
}
