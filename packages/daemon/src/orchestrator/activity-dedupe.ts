import type { AgentActivityState } from '@losina/ipc';

/**
 * Tracks the last (state, taskId) pair reported for one agent and says whether a new one is
 * actually a change. Used to stop a poll loop from re-announcing the same activity state (e.g.
 * "idle-waiting") on every tick when nothing about it changed since the last announcement.
 */
export function createActivityDeduper(): (state: AgentActivityState, taskId?: string) => boolean {
  let lastKey: string | undefined;
  return (state, taskId) => {
    const key = `${state}:${taskId ?? ''}`;
    if (key === lastKey) return false;
    lastKey = key;
    return true;
  };
}
