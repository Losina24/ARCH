export class RunAbortedError extends Error {
  constructor(runId: string) {
    super(`Run aborted: ${runId}`);
  }
}
