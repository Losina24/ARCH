import type { RunEventBus } from '@losina/core';
import type { NewTaskSpec, RunMeta } from '@losina/schemas';

export interface QueuedRetry {
  taskId: string;
  message?: string;
}

export class RunManager {
  private readonly runs = new Map<string, RunMeta>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly pendingRetries = new Map<string, QueuedRetry[]>();
  // Tasks a chat turn decided to add to an already-live run's plan — the implementation loop
  // applies them to its own in-memory tasks-index on its next tick, same reasoning as
  // pendingRetries above: mutating the loop's copy directly here would race its own periodic saves.
  private readonly pendingNewTasks = new Map<string, NewTaskSpec[]>();
  // In-memory only, keyed by runId then taskId — exists purely so a human's retryTask reply can
  // be broadcast as a properly-seq'd consultation:answered event. Lost on daemon restart, which
  // is fine: the TUI's own clearing rule for a pending consultation is driven by task status
  // (see run-detail-view.tsx), not by this event, so nothing depends on it surviving a restart.
  private readonly pendingConsultations = new Map<string, Map<string, number>>();
  // The implementation loop's bus is otherwise a local `const` unreachable from here — registered
  // so `run.chat` can push a chat:requested event onto an already-live Architect loop instead of
  // going through the one-shot triggerChatPhase path meant for phases with no live Architect.
  private readonly eventBuses = new Map<string, RunEventBus>();
  // Counts chat calls in flight (either path) so hasActiveWork() stays true while one is running —
  // otherwise asking a `done`/`blocked` run something right as the daemon would otherwise go idle
  // could have its reply cut off mid-flight by an idle shutdown.
  private pendingChats = 0;

  list(): RunMeta[] {
    return [...this.runs.values()];
  }

  get(runId: string): RunMeta | undefined {
    return this.runs.get(runId);
  }

  register(run: RunMeta): void {
    this.runs.set(run.runId, run);
  }

  update(runId: string, patch: Partial<Omit<RunMeta, 'runId'>>): RunMeta {
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Run not found: ${runId}`);
    const updated: RunMeta = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.runs.set(runId, updated);
    return updated;
  }

  setAbortController(runId: string, controller: AbortController): void {
    this.abortControllers.set(runId, controller);
  }

  getAbortController(runId: string): AbortController | undefined {
    return this.abortControllers.get(runId);
  }

  clearAbortController(runId: string): void {
    this.abortControllers.delete(runId);
  }

  /** True while any run has a live AbortController, or a chat call is in flight. */
  hasActiveWork(): boolean {
    return this.abortControllers.size > 0 || this.pendingChats > 0;
  }

  setEventBus(runId: string, bus: RunEventBus): void {
    this.eventBuses.set(runId, bus);
  }

  getEventBus(runId: string): RunEventBus | undefined {
    return this.eventBuses.get(runId);
  }

  clearEventBus(runId: string): void {
    this.eventBuses.delete(runId);
  }

  beginChat(): void {
    this.pendingChats += 1;
  }

  endChat(): void {
    this.pendingChats = Math.max(0, this.pendingChats - 1);
  }

  /**
   * Queues a retry for a task while its run's implementation loop is still live (siblings still
   * in flight). The loop itself applies it to its own in-memory tasks-index on its next tick —
   * mutating the loop's copy directly here would race with the loop's own periodic disk writes.
   */
  queueRetry(runId: string, taskId: string, message?: string): void {
    const queue = this.pendingRetries.get(runId) ?? [];
    queue.push({ taskId, message });
    this.pendingRetries.set(runId, queue);
  }

  /** Removes and returns every retry queued for this run so far. */
  drainRetries(runId: string): QueuedRetry[] {
    const queue = this.pendingRetries.get(runId) ?? [];
    this.pendingRetries.delete(runId);
    return queue;
  }

  /** Queues new tasks a chat turn added to this run's plan while its implementation loop is
   * still live — see pendingNewTasks above. */
  queueNewTasks(runId: string, tasks: NewTaskSpec[]): void {
    const queue = this.pendingNewTasks.get(runId) ?? [];
    queue.push(...tasks);
    this.pendingNewTasks.set(runId, queue);
  }

  /** Removes and returns every new task queued for this run so far. */
  drainNewTasks(runId: string): NewTaskSpec[] {
    const queue = this.pendingNewTasks.get(runId) ?? [];
    this.pendingNewTasks.delete(runId);
    return queue;
  }

  /** Records that a task's consultation question is pending, so a later reply gets its seq. */
  setPendingConsultation(runId: string, taskId: string, seq: number): void {
    const forRun = this.pendingConsultations.get(runId) ?? new Map<string, number>();
    forRun.set(taskId, seq);
    this.pendingConsultations.set(runId, forRun);
  }

  /** Removes and returns the pending consultation's seq for this task, if any. */
  takePendingConsultation(runId: string, taskId: string): number | undefined {
    const forRun = this.pendingConsultations.get(runId);
    const seq = forRun?.get(taskId);
    forRun?.delete(taskId);
    return seq;
  }

  unregister(runId: string): void {
    this.runs.delete(runId);
    this.abortControllers.delete(runId);
    this.pendingRetries.delete(runId);
    this.pendingNewTasks.delete(runId);
    this.pendingConsultations.delete(runId);
    this.eventBuses.delete(runId);
  }
}
