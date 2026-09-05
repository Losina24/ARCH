import type { AgentActivityEvent, AgentRole, ArchMeshEvent } from '@losina/ipc';
import { neonGradientColor } from './neon-gradient.js';

const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'awaiting_human']);

export type AgentStatusCategory = 'idle' | 'working' | 'blocked' | 'waiting';

export interface AgentStatusEntry {
  agentId: string;
  role: AgentRole;
  label: string;
  statusText: string;
  category: AgentStatusCategory;
}

const ROLE_LABEL: Record<AgentRole, string> = {
  architect: 'Architect',
  worker: 'Worker',
};

const ROLE_VERB: Record<AgentRole, string> = {
  architect: 'Reviewing',
  worker: 'Working on',
};

const ROLE_COLOR_T: Record<AgentRole, number> = {
  architect: 0,
  worker: 1,
};

/** Same neon-gradient color per role everywhere an "Agents"/"Models" list shows Architect/Worker. */
export function agentRoleColor(role: AgentRole): string {
  return neonGradientColor(ROLE_COLOR_T[role] ?? 1);
}

// A worker's `idle-waiting` with a taskId is not genuine idleness — it's the pause tl-loop.ts
// emits after routing a crash to `awaiting_human` (see isHumanInterventionNeeded). That task is
// still stuck waiting on a person, so it must never read as "available" the way a real idle
// worker does.
function isAwaitingHumanPause(event: AgentActivityEvent): boolean {
  return event.role === 'worker' && event.state === 'idle-waiting' && event.taskId !== undefined;
}

function categoryFor(event: AgentActivityEvent | undefined): AgentStatusCategory {
  if (!event) return 'idle';
  if (event.state === 'failed') return 'blocked';
  if (isAwaitingHumanPause(event)) return 'waiting';
  if (event.state === 'idle-waiting' || event.state === 'completed') return 'idle';
  return 'working';
}

function statusTextFor(event: AgentActivityEvent | undefined, role: AgentRole): string {
  if (!event) return 'Waiting';
  if (isAwaitingHumanPause(event)) {
    return `Needs your help · ${event.taskId}`;
  }
  if (event.state === 'thinking' || event.state === 'using-tool') {
    const detail =
      event.detail ??
      (event.state === 'using-tool' && event.tool ? `Using ${event.tool}` : undefined);
    if (detail) {
      const withFile = event.file ? `${detail} · ${event.file}` : detail;
      return event.taskId ? `${withFile} · ${event.taskId}` : withFile;
    }
    if (event.taskId) return `${ROLE_VERB[role]} ${event.taskId}`;
  }
  switch (event.state) {
    case 'spawning':
      return 'Starting…';
    case 'thinking':
      return 'Thinking…';
    case 'using-tool':
      return event.tool ? `Using ${event.tool}` : 'Working…';
    case 'idle-waiting':
      return 'Waiting';
    case 'completed':
      return 'Idle';
    case 'failed':
      return event.taskId ? `Failed on ${event.taskId}` : 'Failed';
    default:
      return 'Waiting';
  }
}

/**
 * Latest event per agentId, and a bounded, reusable slot number per distinct worker agentId.
 *
 * A worker agentId is `worker-${taskId}` — one per task, never shared — but the "Worker N" label
 * is a display concept bound to real concurrency: once a task reaches a terminal status
 * (done/failed/awaiting_human), its slot number is freed and handed to the next new worker
 * agentId, instead of growing forever with every task ever dispatched. `workerOrder` maps every
 * worker agentId to its latest slot (a resumed agent may move if its old slot was reused), while
 * `currentSlotAgent` maps each slot number to whichever agentId currently occupies it.
 */
function indexEvents(events: ArchMeshEvent[]) {
  const latestByAgent = new Map<string, AgentActivityEvent>();
  const workerOrder = new Map<string, number>();
  const currentSlotAgent = new Map<number, string>();
  const taskToAgent = new Map<string, string>();
  // A Set is essential here: the same task can legitimately enter `failed` more than once
  // across manual retries. Recording the same free slot twice would let two later workers both
  // consume (and overwrite) that slot, making concurrent tasks all appear as "Worker 1".
  const freeSlots = new Set<number>();
  let slotsCreated = 0;

  const assignSlot = (agentId: string): number => {
    const reusableSlot = [...freeSlots].sort((a, b) => a - b)[0];
    const slot = reusableSlot ?? ++slotsCreated;
    freeSlots.delete(slot);
    workerOrder.set(agentId, slot);
    currentSlotAgent.set(slot, agentId);
    return slot;
  };

  const occupySlot = (agentId: string): number => {
    const previousSlot = workerOrder.get(agentId);
    if (previousSlot === undefined) return assignSlot(agentId);

    // A failed/awaiting task may resume with the same agentId. If nobody reused its old slot,
    // simply claim it again. If another task now owns it, give the resumed agent another free
    // slot so two live workers can never share one display identity.
    if (currentSlotAgent.get(previousSlot) === agentId) {
      freeSlots.delete(previousSlot);
      return previousSlot;
    }
    return assignSlot(agentId);
  };

  const releaseSlot = (agentId: string | undefined) => {
    if (agentId === undefined) return;
    const slot = workerOrder.get(agentId);
    if (slot !== undefined && currentSlotAgent.get(slot) === agentId) freeSlots.add(slot);
  };

  for (const event of events) {
    if (event.type === 'agent:activity') {
      // A run started before the fictional "TL" agent role was removed may still have
      // role:'tl' events in its persisted event log — ignore them rather than showing a
      // stray, unlabeled row for a role that no longer exists. Cast to string: AgentRole
      // itself no longer includes 'tl', but old on-disk data isn't bound by today's type.
      const role: string = event.role;
      if (role !== 'architect' && role !== 'worker') continue;
      latestByAgent.set(event.agentId, event);
      if (event.role === 'worker') {
        if (event.taskId) taskToAgent.set(event.taskId, event.agentId);
        if (!workerOrder.has(event.agentId)) occupySlot(event.agentId);
        else if (
          event.state === 'spawning' ||
          event.state === 'thinking' ||
          event.state === 'using-tool'
        )
          occupySlot(event.agentId);

        // A setup/dispatch failure can emit the terminal task status before the first worker
        // activity, when taskToAgent was not known yet. Release on the worker event as well so
        // that ordering does not leak a permanently occupied slot.
        if (event.state === 'failed' || isAwaitingHumanPause(event)) releaseSlot(event.agentId);
      }
      continue;
    }
    if (event.type === 'task:status-changed') {
      const agentId = taskToAgent.get(event.taskId);
      if (TERMINAL_TASK_STATUSES.has(event.status)) releaseSlot(agentId);
      else if (event.status === 'in_progress' && agentId !== undefined) occupySlot(agentId);
    }
  }

  return { latestByAgent, workerOrder, currentSlotAgent };
}

/** Maps every worker agentId ever seen to its display label ("Architect", "Worker 1", …). */
export function buildAgentLabels(events: ArchMeshEvent[]): Map<string, string> {
  const { latestByAgent, workerOrder } = indexEvents(events);
  const labels = new Map<string, string>();

  for (const event of latestByAgent.values()) {
    if (event.role === 'worker') {
      labels.set(event.agentId, `${ROLE_LABEL.worker} ${workerOrder.get(event.agentId)}`);
    } else {
      labels.set(event.agentId, ROLE_LABEL[event.role]);
    }
  }

  return labels;
}

/**
 * All worker agentIds that have ever occupied the same numbered slot as `agentId` (including
 * itself), in first-appearance order — so viewing "Worker N"'s transcript can show the full
 * history of every task that slot has ever been assigned, not just its current occupant.
 * Non-worker agentIds (the Architect, which never shares a slot) just return `[agentId]`.
 */
export function workerSlotGroup(events: ArchMeshEvent[], agentId: string): string[] {
  const { workerOrder } = indexEvents(events);
  const slot = workerOrder.get(agentId);
  if (slot === undefined) return [agentId];

  const members: string[] = [];
  for (const [candidateId, candidateSlot] of workerOrder) {
    if (candidateSlot === slot) members.push(candidateId);
  }
  return members;
}

/**
 * One status entry per currently-occupied slot: the Architect always shown, then one per
 * live worker slot (bounded by real concurrency, not by how many tasks have run so far).
 */
export function deriveAgentStatuses(events: ArchMeshEvent[]): AgentStatusEntry[] {
  const { latestByAgent, currentSlotAgent } = indexEvents(events);
  const eventsByRole = [...latestByAgent.values()];

  const architectEvent = eventsByRole.find((event) => event.role === 'architect');

  const entries: AgentStatusEntry[] = [
    {
      agentId: architectEvent?.agentId ?? 'architect',
      role: 'architect',
      label: ROLE_LABEL.architect,
      statusText: statusTextFor(architectEvent, 'architect'),
      category: categoryFor(architectEvent),
    },
  ];

  const slots = [...currentSlotAgent.keys()].sort((a, b) => a - b);
  for (const slot of slots) {
    const agentId = currentSlotAgent.get(slot) as string;
    const event = latestByAgent.get(agentId);
    entries.push({
      agentId,
      role: 'worker',
      label: `${ROLE_LABEL.worker} ${slot}`,
      statusText: statusTextFor(event, 'worker'),
      category: categoryFor(event),
    });
  }

  return entries;
}

/** The agentId of the most recently active agent assigned to a given task, if any. */
export function latestAssignedAgent(
  events: AgentActivityEvent[],
  taskId: string,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.taskId === taskId) return event.agentId;
  }
  return undefined;
}
