import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ClaudeApiRejectionError, ClaudeStreamAbortedError } from '@losina/claude-runtime';
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
  mergeWorktree,
  removeWorktree,
  revertFiles,
  saveRunSessions,
  saveTasksIndex,
  scopesConflict,
  stagePaths,
  workerAgentId,
  writeReviewRequest,
} from '@losina/core';
import type { AgentMeshConfig, RunMeta, RunSessions, Task, TasksIndex } from '@losina/schemas';
import {
  type CorrectionSource,
  type DispatchWorkerInput,
  dispatchWorker,
  processWorkerReport,
} from '@losina/tl';
import {
  buildCorrectionPrompt,
  isHumanInterventionNeeded,
  isInfraFailure,
} from '@losina/validator';
import type { Mutex } from './mutex.js';
import { RunAbortedError } from './run-aborted-error.js';
import { waitForReviewOutcome } from './wait-for-review-outcome.js';

/**
 * Cap for retrying just the automated checks (not the Worker) when a failure looks like an
 * infra/network blip rather than a code problem — e.g. a DNS lookup or registry transfer that
 * failed. The Worker can't fix that by changing code, so it shouldn't burn a correction round
 * on it; retrying the checks alone costs nothing extra and often succeeds once the blip clears.
 */
const MAX_INFRA_CHECK_RETRIES = 3;

/**
 * Cap for automatic retries of a worker dispatch that failed for reasons the Worker had no part
 * in — either Claude's CLI rejecting the call before any turn ran (ClaudeApiRejectionError,
 * $0 billed) or its turn loop getting cut off mid-response (ClaudeStreamAbortedError, some cost
 * already billed but no usable output produced). Both are transient and always safe to retry
 * as-is. Deliberately separate from config.execution.maxRetries: that budget caps
 * content-correction rounds (failed checks, scope violations, review rejections), a different
 * concern from retrying an infrastructure-level dispatch failure that never produced any output.
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
 * Every other task's declared scope, for attributing a shared `run.cwd`'s dirty files to the
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

function describeTransientDispatchFailure(
  error: ClaudeApiRejectionError | ClaudeStreamAbortedError,
): string {
  return error instanceof ClaudeApiRejectionError
    ? 'dispatch rejected before execution'
    : 'dispatch aborted mid-stream';
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
      const isTransient =
        error instanceof ClaudeApiRejectionError || error instanceof ClaudeStreamAbortedError;
      if (!isTransient || retries >= MAX_TRANSIENT_DISPATCH_RETRIES) {
        throw error;
      }
      retries += 1;
      console.error(
        `[daemon] task ${taskId} ${describeTransientDispatchFailure(error)} (attempt ${retries}/${MAX_TRANSIENT_DISPATCH_RETRIES}), retrying:`,
        error.message,
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
        await removeWorktree(run.cwd, worktree);
      } catch (removeError) {
        console.error(`[daemon] failed to remove worktree for ${task.id}:`, removeError);
      }
      try {
        await deleteBranch(run.cwd, worktree);
      } catch (deleteError) {
        console.error(`[daemon] failed to delete branch for ${task.id}:`, deleteError);
      }
    } finally {
      unlockCleanup();
    }
  };

  // Without worktree isolation, a task that ends in real failure must not leave its own
  // uncommitted edits sitting dirty in the shared `run.cwd` — otherwise getChangedFiles'
  // repo-wide `git status` would keep attributing them to whichever sibling task checks its
  // scope next, forever. Re-derives "this task's files" the same way the scope check above
  // does (current dirty files minus whatever falls in another task's declared scope) rather
  // than reusing a loop-scoped variable, since a crash can happen before any round produces one.
  const revertOwnFiles = async (): Promise<void> => {
    if (!worktree || config.execution.useWorktrees) return;
    const changed = await getChangedFiles(worktree.path);
    const others = otherScopedTasks(tasksIndex, task.id);
    const files = changed.filter(
      (file) => !others.some((other) => scopesConflict([file], other.scope)),
    );
    if (files.length === 0) return;
    const unlockRevert = await gitMutex.lock();
    try {
      await revertFiles(worktree.path, files);
    } finally {
      unlockRevert();
    }
  };

  try {
    if (config.execution.useWorktrees) {
      const unlockCreate = await gitMutex.lock();
      try {
        worktree = await createWorktree(run.cwd, worktreesDir, task.id);
      } finally {
        unlockCreate();
      }
      // A fresh worktree only checks out tracked files, so a gitignored node_modules never
      // exists there — without this, every check that needs installed dependencies fails
      // no matter how correct the Worker's change is. Skipped entirely without worktrees:
      // worktree.path is then run.cwd itself, the user's already-set-up project directory,
      // shared by every concurrent task — reinstalling there on every task cycle would be
      // wasteful and, for npm's rm -rf-then-reinstall ci, actively racy.
      await installWorktreeDependencies(worktree.path);
    } else {
      worktree = { path: run.cwd, branch: '' };
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
        signal,
        detectChanges: config.execution.useWorktrees ? undefined : getChangedFiles,
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
      // several tasks share `run.cwd`, so a file must first be attributed to this task
      // by excluding whatever falls inside another task's declared scope — otherwise a
      // sibling's still in-progress edit, or an already-`done` sibling's approved work that
      // ARCH deliberately left uncommitted, would look like a scope violation of this task.
      let ownFiles = dispatch.filesChanged;
      if (!config.execution.useWorktrees) {
        const others = otherScopedTasks(tasksIndex, task.id);
        ownFiles = dispatch.filesChanged.filter(
          (file) => !others.some((other) => scopesConflict([file], other.scope)),
        );
      }

      if (!config.execution.useWorktrees && task.scope.length > 0) {
        const violations = ownFiles.filter((file) => !scopesConflict([file], task.scope));
        if (violations.length > 0) {
          const scopeCorrection = `The following changed files are outside this task's declared scope (${task.scope.join(', ')}): ${violations.join(', ')}. Revert any changes outside your scope and only modify files within it.`;
          await persistCorrection(scopeCorrection);
          if (task.retries >= config.execution.maxRetries) {
            await saveTasksIndex(tasksIndexPath, tasksIndex);
            await setStatus(
              'failed',
              `Files changed outside the task's declared scope (${task.scope.join(', ')}): ${violations.join(', ')}.`,
            );
            await revertOwnFiles();
            await cleanupWorktree();
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
          await saveTasksIndex(tasksIndexPath, tasksIndex);
          await setStatus(
            'failed',
            `Automated checks kept failing after ${MAX_INFRA_CHECK_RETRIES} retries with what looks like an infrastructure/environment issue, not a code problem:\n\n${correctionText}`,
          );
          await revertOwnFiles();
          await cleanupWorktree();
          return;
        }

        if (task.retries >= config.execution.maxRetries) {
          await saveTasksIndex(tasksIndexPath, tasksIndex);
          await setStatus('failed', correctionText);
          await revertOwnFiles();
          await cleanupWorktree();
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
        const targetBranch = await getCurrentBranch(run.cwd);
        const canAutoCommit = config.execution.useWorktrees && targetBranch !== PROTECTED_BRANCH;

        if (config.execution.useWorktrees) {
          // Committing inside the isolated worktree is always safe — that branch is ARCH's
          // own `feat/<taskId>`, never the user's, regardless of what run.cwd is checked out to.
          await commitAll(worktree.path, `${task.id}: ${task.title}`);
          if (canAutoCommit) {
            const unlockMerge = await gitMutex.lock();
            try {
              await mergeWorktree(run.cwd, worktree);
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
          // Without worktree isolation, worktree.path is run.cwd itself — the user's real,
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
        await saveTasksIndex(tasksIndexPath, tasksIndex);
        await setStatus(
          'failed',
          outcome.correctionMarkdown ?? 'Review rejected the task without further details.',
        );
        await revertOwnFiles();
        await cleanupWorktree();
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
    // `git worktree remove` is still racing the caller's next move.
    const needsHuman = isHumanInterventionNeeded(message);
    if (needsHuman) {
      await setStatus('awaiting_human', message);
    } else {
      await setStatus('failed', message);
      // Only once the task is truly abandoned (not paused for a human to resume it in the
      // same session) — otherwise whatever the worker wrote before crashing would vanish out
      // from under a session it's meant to pick back up.
      await revertOwnFiles();
    }
    await cleanupWorktree();
    bus.emit({
      type: 'agent:activity',
      runId,
      agentId,
      role: 'worker',
      taskId: task.id,
      state: needsHuman ? 'idle-waiting' : 'failed',
    });
    // setStatus() above already broadcast `message` as this task-status event's
    // failureReason, which the Console transcript renders in the status's own tone (red for
    // failed, blue for awaiting_human) — emitting it again as a plain agent:message would just
    // duplicate the same text a second time in white.
  }
}
