import type { ArchClient } from '@losina/daemon-client';

export interface ExitAppOptions {
  /** Shut down the daemon unconditionally, even mid-run. */
  force?: boolean;
}

/**
 * Shared exit path for every way the TUI can end: /quit, Ctrl+C, and the
 * forceful /close-all override. A plain exit leaves the daemon alive when a
 * run is mid-implementation, so background work isn't interrupted just
 * because the TUI closed; /close-all (force: true) skips that check.
 */
export async function exitApp(
  client: ArchClient | null,
  options: ExitAppOptions = {},
): Promise<never> {
  if (client) {
    try {
      if (options.force) {
        await client.shutdownDaemon();
      } else {
        const runs = await client.listRuns();
        const hasActiveWork = runs.some((run) => run.phase === 'implementation');
        if (!hasActiveWork) await client.shutdownDaemon();
      }
    } catch {
      // Best effort — the TUI process exits regardless of daemon reachability.
    }
  }
  process.exit(0);
}
