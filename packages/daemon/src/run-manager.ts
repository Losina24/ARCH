import type { RunMeta } from '@arch/schemas';

export interface QueuedRetry {
  taskId: string;
  message?: string;
}

export class RunManager {
  private readonly runs = new Map<string, RunMeta>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly pendingRetries = new Map<string, QueuedRetry[]>();

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

  /** True while any run has a live AbortController — the only reliable signal of in-process work. */
  hasActiveWork(): boolean {
    return this.abortControllers.size > 0;
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

  unregister(runId: string): void {
    this.runs.delete(runId);
    this.abortControllers.delete(runId);
    this.pendingRetries.delete(runId);
  }
}
