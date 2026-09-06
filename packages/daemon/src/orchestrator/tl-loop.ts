import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describeTransientDispatchFailure, isTransientDispatchError } from '@losina/agent-runtime';
import {
  type RunEventBus,
  commitAll,
  createWorktree,
  deleteBranch,
  getChangedFiles,
  getCurrentBranch,
  getStagedDiff,
  getWorkingDiff,
  installWorktreeDependencies,
  loadRunSessions,
  mergeDependencyBranches,
  mergeWorktree,
  removeWorktree,
  revertFiles,
  saveRunSessions,
  saveTasksIndex,
  scopesConflict,
  stagePaths,
  workerAgentId,
  writeConsultationRequest,
  writeReviewRequest,
} from '@losina/core';
import type {
  AgentMeshConfig,
  ConsultationFailureKind,
  RunMeta,
  RunSessions,
  Task,
  TasksIndex,
} from '@losina/schemas';
import {
  buildCorrectionPrompt,
  isHumanInterventionNeeded,
  isInfraFailure,
} from '@losina/validator';
import { activityFromProgress } from './agent-progress.js';
import { resolveDependencyBriefs } from './dependency-context.js';
import { type DispatchWorkerInput, dispatchWorker } from './dispatch-worker.js';
import type { Mutex } from './mutex.js';
import { processWorkerReport } from './process-worker-report.js';
import { RunAbortedError } from './run-aborted-error.js';
import { resolveTaskRepoRoot } from './task-repo-root.js';
import { waitForConsultationOutcome } from './wait-for-consultation-outcome.js';
import { waitForReviewOutcome } from './wait-for-review-outcome.js';
import type { CorrectionSource } from './worker-prompts.js';

/**
 * Cap on how long a stuck-task consultation may keep the Architect busy before this task cycle
 * gives up on it — a consultation is best-effort commentary, and must never delay a task's own
 * finalization by more than a bounded amount.
 */
const CONSULTATION_TIMEOUT_MS = 120_000;

/**
 * Cap for retrying just the automated checks (not the Worker) when a failure looks like an
 * infra/network blip rather than a code problem — e.g. a DNS lookup or registry transfer that
 * failed. The Worker can't fix that by changing code, so it shouldn't burn a correction round
 * on it; retrying the checks alone costs nothing extra and often succeeds once the blip clears.
 */
const MAX_INFRA_CHECK_RETRIES = 3;

/**
 * Cap for automatic retries of a worker dispatch that failed for reasons the Worker had no part
 * in — either the CLI rejecting the call before any turn ran ($0/no-op billed), its turn loop
 * getting cut off mid-response, or Codex reaching an explicitly configured execution timeout.
 * Interrupted turns may have left useful partial files behind, so the retry deliberately stays
 * inside this task cycle and reuses its worktree. Deliberately separate from
 * config.execution.maxRetries: that budget caps content-correction rounds (failed checks, scope
 * violations, review rejections), a different concern from recovering an infrastructure-level
 * dispatch failure before validation or Architect review.
 */
const MAX_TRANSIENT_DISPATCH_RETRIES = 3;

/**
 * IMPORTANT safety net: ARCH must never auto-commit onto the user's real, already-checked-out
 * branch — only onto its own disposable, isolated `feat/<taskId>` worktree branches. This is
 * what let TASK-001/TASK-003 land two commits directly on the user's local `develop` branch
 * when the run's target repo had it checked out. Guarded here, at the single place every task
 * decides whether to persist its approved work, rather than relying on worker/prompt behavior.
 */
const PROTECTED_BRANCH = 'develop';

/**
 * Every other task's declared scope, for attributing a shared repo's dirty files to the
 * task that actually owns them. Deliberately sourced from the full `tasksIndex` rather than
 * only tasks currently in flight: without worktree isolation, an already-`done` task leaves its
 * approved work staged-but-uncommitted in that same shared directory (ARCH never auto-commits
 * there), so its files are still on disk and indistinguishable from a live sibling's — dropping
 * it from consideration the moment its cycle ends previously caused those files to be
 * misattributed to whichever task checked its own scope next, up to and including reverting
 * another task's already-approved work as if it were this task's own scope violation.
 *
 * Tasks with an empty (default) `scope` are excluded from this set, not just from the
 * per-task-id filter: `scopesConflict` treats an empty scope as conflicting with everything, so
 * including one here would cause every file in the repo to be attributed to that other task
 * forever, silently disabling scope-violation detection and failure revert for the whole run.
 */
function otherScopedTasks(tasksIndex: TasksIndex, taskId: string): Task[] {
  return tasksIndex.tasks.filter((other) => other.id !== taskId && other.scope.length > 0);
}

/**
 * Narrows `files` (a shared repo's dirty/changed files) down to the ones that actually belong to
 * `taskId`, by excluding anything that falls inside another task's declared scope — see
 * `otherScopedTasks` for why that other-task set is sourced from the full index rather than only
 * in-flight tasks. Only meaningful without worktree isolation, where several tasks' files can
 * land in the same working tree; with isolation every changed file already belongs to this task.
 */
function attributeFilesToTask(files: string[], tasksIndex: TasksIndex, taskId: string): string[] {
  const others = otherScopedTasks(tasksIndex, taskId);
  return files.filter((file) => !others.some((other) => scopesConflict([file], other.scope)));
}

async function dispatchWorkerWithTransientErrorRetry(
  taskId: string,
  input: DispatchWorkerInput,
): ReturnType<typeof dispatchWorker> {
  let retries = 0;
  while (true) {
    try {
      return await dispatchWorker(input);
    } catch (error) {
      if (!isTransientDispatchError(error) || retries >= MAX_TRANSIENT_DISPATCH_RETRIES) {
        throw error;
      }
      retries += 1;
      console.error(
        `[daemon] task ${taskId} ${describeTransientDispatchFailure(error)} (attempt ${retries}/${MAX_TRANSIENT_DISPATCH_RETRIES}), retrying:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

export interface TlTaskCycleParams {
  run: RunMeta;
  task: Task;
  tasksIndex: TasksIndex;
  tasksIndexPath: string;
  runDir: string;
  worktreesDir: string;
  config: AgentMeshConfig;
  bus: RunEventBus;
  gitMutex: Mutex;
  signal: AbortSignal;
  /** A human's note to the worker, injected only on this cycle's first dispatch attempt. */
  humanMessage?: string;
}

async function mergeWorkerSession(
  runDir: string,
  taskId: string,
  sessionId: string,
): Promise<RunSessions> {
  const latest = await loadRunSessions(runDir);
  const merged: RunSessions = {
    ...latest,
    taskSessions: { ...latest.taskSessions, [taskId]: sessionId },
  };
  await saveRunSessions(runDir, merged);
  return merged;
}

export async function runTlTaskCycle(params: TlTaskCycleParams): Promise<void> {
  const {
    run,
    task,
    tasksIndex,
    tasksIndexPath,
    runDir,
    worktreesDir,
    config,
    bus,
    gitMutex,
    signal,
    humanMessage,
  } = params;
  const runId = run.runId;
  const agentId = workerAgentId(task.id);
  const repoRoot = resolveTaskRepoRoot(run, task);

  const setStatus = async (status: Task['status'], failureReason?: string) => {
    task.status = status;
    if (failureReason !== undefined) {
      task.failureReason = failureReason;
    }
    await saveTasksIndex(tasksIndexPath, tasksIndex);
    bus.emit({ type: 'task:status-changed', runId, taskId: task.id, status, failureReason });
  };

  const throwIfAborted = () => {
    if (signal.aborted) throw new RunAbortedError(runId);
  };

  const taskMarkdown = await readFile(join(runDir, task.file), 'utf-8');
  const dependencies = await resolveDependencyBriefs(tasksIndex, task, runDir);
  const initialSessions = await loadRunSessions(runDir);
  let workerSessionId = initialSessions.taskSessions[task.id];
  let correctionMarkdown: string | undefined;
  let correctionSource: CorrectionSource | undefined;
  let worktree: Awaited<ReturnType<typeof createWorktree>> | undefined;
  let reviewSeq = 0;

  const persistCorrection = async (markdown: string): Promise<void> => {
    const correctionFilePath = join(
      runDir,
      'tasks',
      `${task.id}.corrections.${task.correctionFiles.length + 1}.md`,
    );
    await writeFile(correctionFilePath, markdown, 'utf-8');
    task.correctionFiles = [...task.correctionFiles, relative(runDir, correctionFilePath)];
  };

  const cleanupWorktree = async () => {
    if (!worktree || !config.execution.useWorktrees) return;
    const unlockCleanup = await gitMutex.lock();
    try {
      // Independent try/catches: a failure removing the worktree (e.g. it still has
      // uncommitted changes) must not prevent the branch deletion from being attempted too.
      try {
        await removeWorktree(repoRoot, worktree);
      } catch (removeError) {
        console.error(`[daemon] failed to remove worktree for ${task.id}:`, removeError);
      }
      try {
        await deleteBranch(repoRoot, worktree);
      } catch (deleteError) {
        console.error(`[daemon] failed to delete branch for ${task.id}:`, deleteError);
      }
    } finally {
      unlockCleanup();
    }
  };

  // Without worktree isolation, a task that ends in real failure must not leave its own
  // uncommitted edits sitting dirty in the shared repo — otherwise getChangedFiles'
  // repo-wide `git status` would keep attributing them to whichever sibling task checks its
  // scope next, forever. Re-derives "this task's files" the same way the scope check above
  // does (current dirty files minus whatever falls in another task's declared scope) rather
  // than reusing a loop-scoped variable, since a crash can happen before any round produces one.
  const revertOwnFiles = async (): Promise<void> => {
    if (!worktree || config.execution.useWorktrees) return;
    const changed = await getChangedFiles(worktree.path);
    const files = attributeFilesToTask(changed, tasksIndex, task.id);
    if (files.length === 0) return;
    const unlockRevert = await gitMutex.lock();
    try {
      await revertFiles(worktree.path, files);
    } finally {
      unlockRevert();
    }
  };

  let consultationSeq = 0;

  /**
   * The single place every escalation-to-human site (scope violation, failed checks, an infra
   * blip that never recovered, a review rejected past the retry budget, or a crash) goes through.
   * Order is load-bearing:
   *  1. Best-effort consultation — swallowed entirely on any failure. A consultation must never
   *     be able to change this task's outcome, only add a question to it.
   *  2. Finalize exactly as every call site already did before this existed: persist the status,
   *     revert this task's own files (only when actually failing, not when merely paused for a
   *     human), release the worktree.
   *  3. Only once the task is already terminal and its worktree released does the question (if
   *     any) get surfaced — a human reacting to it calls retryTask, which requires both.
   */
  const escalateToHuman = async (
    status: 'failed' | 'awaiting_human',
    failureReason: string,
    failureKind: ConsultationFailureKind,
    context: { workerSummary?: string; gitDiff?: string } = {},
  ): Promise<void> => {
    let outcome: { question: string; recommendation: string } | undefined;
    let seq: number | undefined;

    if (!signal.aborted) {
      try {
        consultationSeq += 1;
        seq = consultationSeq;
        const consultationFilePath = join(runDir, 'tasks', `${task.id}.consultation.${seq}.json`);
        const correctionMarkdowns = await Promise.all(
          task.correctionFiles.map((file) => readFile(join(runDir, file), 'utf-8')),
        );
        const requestPath = await writeConsultationRequest(runDir, {
          taskId: task.id,
          seq,
          model: config.models.architectModel,
          consultationFilePath,
          taskMarkdown,
          correctionMarkdowns,
          gitDiff: context.gitDiff ?? '',
          workerSummary: context.workerSummary ?? '',
          failureReason,
          failureKind,
          retriesSpent: task.retries,
          maxRetries: config.execution.maxRetries,
        });
        bus.emit({ type: 'consultation:requested', runId, taskId: task.id, seq, requestPath });
        outcome = await waitForConsultationOutcome({
          bus,
          runId,
          taskId: task.id,
          seq,
          signal,
          timeoutMs: CONSULTATION_TIMEOUT_MS,
        });
      } catch (consultationError) {
        console.error(`[daemon] consultation failed for ${task.id}:`, consultationError);
      }
    }

    await saveTasksIndex(tasksIndexPath, tasksIndex);
    await setStatus(status, failureReason);
    if (status === 'failed') {
      try {
        await revertOwnFiles();
      } catch (revertError) {
        console.error(
          `[daemon] failed to revert ${task.id}'s own files after ${failureKind} escalation:`,
          revertError,
        );
      }
    }
    await cleanupWorktree();
    bus.emit({
      type: 'agent:activity',
      runId,
      agentId,
      role: 'worker',
      taskId: task.id,
      state: status === 'awaiting_human' ? 'idle-waiting' : 'failed',
    });

    if (outcome && seq !== undefined) {
      bus.emit({
        type: 'consultation:question-asked',
        runId,
        taskId: task.id,
        seq,
        question: outcome.question,
        recommendation: outcome.recommendation,
        failureReason,
      });
    }
  };

  try {
    if (config.execution.useWorktrees) {
      const unlockCreate = await gitMutex.lock();
      try {
        worktree = await createWorktree(repoRoot, worktreesDir, task.id);
        // Staying inside this same lock matters: it serializes against a concurrent
        // dependency's own cleanupWorktree/deleteBranch, so "does feat/<depId> still exist"
        // can't go stale between the check and the merge below.
        if (task.dependsOn.length > 0) {
          await mergeDependencyBranches(worktree, repoRoot, task.dependsOn);
        }
      } finally {
        unlockCreate();
      }
      // A fresh worktree only checks out tracked files, so a gitignored node_modules never
      // exists there — without this, every check that needs installed dependencies fails
      // no matter how correct the Worker's change is. Skipped entirely without worktrees:
      // worktree.path is then repoRoot itself, the user's already-set-up project directory,
      // shared by every concurrent task in that same repo — reinstalling there on every task
      // cycle would be wasteful and, for npm's rm -rf-then-reinstall ci, actively racy.
      await installWorktreeDependencies(worktree.path);
    } else {
      worktree = { path: repoRoot, branch: '' };
    }

    while (true) {
      throwIfAborted();
      await setStatus('in_progress');

      bus.emit({
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        taskId: task.id,
        state: 'thinking',
        viaHumanPrompt: humanMessage !== undefined && correctionMarkdown === undefined,
      });

      const dispatch = await dispatchWorkerWithTransientErrorRetry(task.id, {
        task,
        taskMarkdown,
        worktree,
        model: config.models.workerModel,
        resumeSessionId: workerSessionId,
        correctionMarkdown,
        correctionSource,
        humanMessage: correctionMarkdown === undefined ? humanMessage : undefined,
        dependencies,
        signal,
        detectChanges: config.execution.useWorktrees ? undefined : getChangedFiles,
        onProgress: (progress) =>
          bus.emit(
            activityFromProgress({ runId, agentId, role: 'worker', taskId: task.id }, progress),
          ),
      });
      workerSessionId = dispatch.sessionId;
      await mergeWorkerSession(runDir, task.id, workerSessionId);

      bus.emit({
        type: 'agent:activity',
        runId,
        agentId,
        role: 'worker',
        taskId: task.id,
        state: 'completed',
      });

      bus.emit({
        type: 'agent:message',
        runId,
        agentId,
        role: 'worker',
        taskId: task.id,
        text: dispatch.summary,
      });

      throwIfAborted();

      // With worktree isolation every changed file belongs to this task. Without it,
      // several tasks can share the same repo, so a file must first be attributed to this task
      // by excluding whatever falls inside another task's declared scope — otherwise a
      // sibling's still in-progress edit, or an already-`done` sibling's approved work that
      // ARCH deliberately left uncommitted, would look like a scope violation of this task.
      let ownFiles = dispatch.filesChanged;
      if (!config.execution.useWorktrees) {
        ownFiles = attributeFilesToTask(dispatch.filesChanged, tasksIndex, task.id);
      }

      if (!config.execution.useWorktrees && task.scope.length > 0) {
        const violations = ownFiles.filter((file) => !scopesConflict([file], task.scope));
        if (violations.length > 0) {
          const scopeCorrection = `The following changed files are outside this task's declared scope (${task.scope.join(', ')}): ${violations.join(', ')}. Revert any changes outside your scope and only modify files within it.`;
          await persistCorrection(scopeCorrection);
          if (task.retries >= config.execution.maxRetries) {
            await escalateToHuman(
              'failed',
              `Files changed outside the task's declared scope (${task.scope.join(', ')}): ${violations.join(', ')}.`,
              'scope',
              { workerSummary: dispatch.summary },
            );
            return;
          }
          task.retries += 1;
          await saveTasksIndex(tasksIndexPath, tasksIndex);
          correctionMarkdown = scopeCorrection;
          correctionSource = 'scope';
          await setStatus('needs_correction');
          continue;
        }
      }

      let validation = await processWorkerReport({
        taskId: task.id,
        worktreePath: worktree.path,
        checks: task.checks,
      });

      // Infra/network failures (DNS, unreachable registry...) can't be fixed by the Worker —
      // retry just the checks a few times before treating this as a correction round at all.
      let infraRetries = 0;
      while (
        !validation.passed &&
        isInfraFailure(validation) &&
        infraRetries < MAX_INFRA_CHECK_RETRIES
      ) {
        infraRetries += 1;
        throwIfAborted();
        validation = await processWorkerReport({
          taskId: task.id,
          worktreePath: worktree.path,
          checks: task.checks,
        });
      }

      if (!validation.passed) {
        const correctionText = buildCorrectionPrompt(validation);
        await persistCorrection(correctionText);

        if (isInfraFailure(validation)) {
          await escalateToHuman(
            'failed',
            `Automated checks kept failing after ${MAX_INFRA_CHECK_RETRIES} retries with what looks like an infrastructure/environment issue, not a code problem:\n\n${correctionText}`,
            'infra',
            { workerSummary: dispatch.summary },
          );
          return;
        }

        if (task.retries >= config.execution.maxRetries) {
          await escalateToHuman('failed', correctionText, 'checks', {
            workerSummary: dispatch.summary,
          });
          return;
        }
        task.retries += 1;
        await saveTasksIndex(tasksIndexPath, tasksIndex);
        correctionMarkdown = correctionText;
        correctionSource = 'checks';
        await setStatus('needs_correction');
        continue;
      }

      await setStatus('in_review');
      throwIfAborted();

      reviewSeq += 1;
      const correctionFilePath = join(
        runDir,
        'tasks',
        `${task.id}.corrections.${task.correctionFiles.length + 1}.md`,
      );
      let gitDiff: string;
      if (config.execution.useWorktrees) {
        gitDiff = await getStagedDiff(worktree.path);
      } else {
        // getWorkingDiff mutates the shared index (`git add -N`) — without worktree
        // isolation, several tasks share the same .git/index, so this must be
        // serialized with every other index-touching operation (stagePaths/commitAll,
        // and other tasks' own getWorkingDiff calls) to avoid racing on index.lock.
        const unlockDiff = await gitMutex.lock();
        try {
          gitDiff = await getWorkingDiff(worktree.path, ownFiles);
        } finally {
          unlockDiff();
        }
      }
      const correctionMarkdowns = await Promise.all(
        task.correctionFiles.map((file) => readFile(join(runDir, file), 'utf-8')),
      );

      const requestPath = await writeReviewRequest(runDir, {
        taskId: task.id,
        seq: reviewSeq,
        model: config.models.architectModel,
        correctionFilePath,
        taskMarkdown,
        correctionMarkdowns,
        gitDiff,
        workerSummary: dispatch.summary,
        dependencyScopes: dependencies.flatMap((dependency) => dependency.scope),
      });

      bus.emit({ type: 'review:requested', runId, taskId: task.id, seq: reviewSeq, requestPath });

      const outcome = await waitForReviewOutcome({
        bus,
        runId,
        taskId: task.id,
        seq: reviewSeq,
        signal,
      });

      if (outcome.approved) {
        // IMPORTANT: never auto-commit onto the user's real branch — see PROTECTED_BRANCH.
        const targetBranch = await getCurrentBranch(repoRoot);
        const canAutoCommit = config.execution.useWorktrees && targetBranch !== PROTECTED_BRANCH;

        if (config.execution.useWorktrees) {
          // Committing inside the isolated worktree is always safe — that branch is ARCH's
          // own `feat/<taskId>`, never the user's, regardless of what repoRoot is checked out to.
          await commitAll(worktree.path, `${task.id}: ${task.title}`);
          if (canAutoCommit) {
            const unlockMerge = await gitMutex.lock();
            try {
              await mergeWorktree(repoRoot, worktree);
            } finally {
              unlockMerge();
            }
            // The code is merged and safe the moment mergeWorktree resolves — this task has
            // succeeded regardless of what happens next. Worktree/branch removal is best-effort
            // housekeeping from here on: a failure there must never flip an already-merged task
            // back to 'failed', so it's deliberately outside this task's success/failure path.
            await setStatus('done');
            await cleanupWorktree();
          } else {
            await setStatus(
              'done',
              `Work approved and committed on the isolated branch "${worktree.branch}" (${worktree.path}), but NOT merged into "${targetBranch}" — ARCH never auto-commits onto that branch. Merge it yourself when ready.`,
            );
          }
        } else {
          // Without worktree isolation, worktree.path is repoRoot itself — the user's real,
          // already-checked-out branch. Stage the approved changes so they're easy to review,
          // but never commit them automatically.
          const unlockCommit = await gitMutex.lock();
          try {
            await stagePaths(worktree.path, ownFiles);
          } finally {
            unlockCommit();
          }
          await setStatus(
            'done',
            `Work approved and staged in ${worktree.path} (branch "${targetBranch}"), but NOT committed — ARCH never auto-commits without worktree isolation. Review and commit yourself when ready.`,
          );
        }
        return;
      }

      task.correctionFiles = [...task.correctionFiles, relative(runDir, correctionFilePath)];
      if (task.retries >= config.execution.maxRetries) {
        await escalateToHuman(
          'failed',
          outcome.correctionMarkdown ?? 'Review rejected the task without further details.',
          'review',
          { workerSummary: dispatch.summary, gitDiff },
        );
        return;
      }
      task.retries += 1;
      await saveTasksIndex(tasksIndexPath, tasksIndex);
      correctionMarkdown = outcome.correctionMarkdown;
      correctionSource = 'review';
      await setStatus('needs_correction');
    }
  } catch (error) {
    if (error instanceof RunAbortedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[daemon] task ${task.id} crashed:`, error);
    // Persist the failure and clean up the worktree before announcing it: a client reacting
    // to the activity event (e.g. reading the plan, or a test proceeding to teardown) must
    // never be able to observe a half-written tasks-index.yaml or a worktree whose
    // `git worktree remove` is still racing the caller's next move. escalateToHuman handles
    // both — see its own doc comment for the full ordering rationale, including why
    // revertOwnFiles only runs when truly abandoning the task (status 'failed'), not when
    // merely pausing it for a human to resume in the same session.
    const needsHuman = isHumanInterventionNeeded(message);
    await escalateToHuman(
      needsHuman ? 'awaiting_human' : 'failed',
      message,
      needsHuman ? 'needs-human' : 'crash',
    );
    // escalateToHuman's setStatus already broadcast `message` as this task-status event's
    // failureReason, which the Console transcript renders in the status's own tone (red for
    // failed, blue for awaiting_human) — emitting it again as a plain agent:message would just
    // duplicate the same text a second time in white.
  }
}
