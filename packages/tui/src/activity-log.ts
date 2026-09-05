import type { ArchMeshEvent } from '@losina/ipc';
import type { TaskStatus } from '@losina/schemas';

export type ActivityLogTone = 'info' | 'success' | 'warning' | 'error' | 'waiting';

export interface ActivityLogEntry {
  id: string;
  text: string;
  tone: ActivityLogTone;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const TASK_STATUS_TEXT: Partial<Record<TaskStatus, (taskId: string) => string>> = {
  in_review: (taskId) => `${taskId} sent for review`,
  needs_correction: (taskId) => `${taskId} needs correction`,
  done: (taskId) => `${taskId} completed`,
  failed: (taskId) => `${taskId} failed`,
  awaiting_human: (taskId) => `${taskId} needs your help`,
};

const TASK_STATUS_TONE: Partial<Record<TaskStatus, ActivityLogTone>> = {
  in_progress: 'info',
  in_review: 'warning',
  needs_correction: 'error',
  done: 'success',
  failed: 'error',
  awaiting_human: 'waiting',
};

/**
 * `isResume` distinguishes a task's first-ever `in_progress` transition ("started") from any
 * later re-entry into `in_progress` ("continued") — after a correction round or after a human
 * resumes a stalled task with a prompt, it's misleading to say the task "started" again.
 */
export function taskStatusLogText(
  status: TaskStatus,
  taskId: string,
  isResume = false,
): string | undefined {
  if (status === 'in_progress') return `${taskId} ${isResume ? 'continued' : 'started'}`;
  return TASK_STATUS_TEXT[status]?.(taskId);
}

export function taskStatusLogTone(status: TaskStatus): ActivityLogTone {
  return TASK_STATUS_TONE[status] ?? 'info';
}

/**
 * Derives a human-readable, chronological log from the raw event stream.
 * Review lifecycle entries come from the dedicated review events. Agent activity is deliberately
 * not used for them: providers may emit many `thinking` updates during one review turn.
 */
export function buildActivityLog(
  events: ArchMeshEvent[],
  timestamps?: number[],
): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];
  const seenInProgress = new Set<string>();

  events.forEach((event, index) => {
    const id = `${index}`;
    const timestamp = timestamps?.[index];
    const withTime = (text: string) =>
      timestamp === undefined ? text : `${formatTime(timestamp)} ${text}`;

    if (event.type === 'task:status-changed') {
      if (event.status === 'in_progress') {
        const text = taskStatusLogText(
          event.status,
          event.taskId,
          seenInProgress.has(event.taskId),
        );
        seenInProgress.add(event.taskId);
        entries.push({ id, text: withTime(text as string), tone: 'info' });
        return;
      }
      const text = TASK_STATUS_TEXT[event.status]?.(event.taskId);
      if (text)
        entries.push({ id, text: withTime(text), tone: TASK_STATUS_TONE[event.status] ?? 'info' });
      return;
    }

    if (event.type === 'agent:activity') {
      if (event.state === 'failed' && !event.taskId) {
        entries.push({ id, text: withTime('Architect failed during planning'), tone: 'error' });
      }
      return;
    }

    if (event.type === 'agent:message' || event.type === 'human:prompt-sent') {
      return;
    }

    if (event.type === 'grilling:question-asked') {
      entries.push({
        id,
        text: withTime('Architect asked a clarifying question'),
        tone: 'warning',
      });
      return;
    }

    if (event.type === 'grilling:answered') {
      entries.push({
        id,
        text: withTime(event.skipped ? 'Grilling skipped' : 'Answered the Architect'),
        tone: 'info',
      });
      return;
    }

    if (event.type === 'review:requested') {
      entries.push({ id, text: withTime(`Review started on ${event.taskId}`), tone: 'warning' });
      return;
    }

    if (event.type === 'review:completed') {
      entries.push({
        id,
        text: withTime(
          event.approved
            ? `Review approved for ${event.taskId}`
            : `Review sent corrections for ${event.taskId}`,
        ),
        tone: event.approved ? 'success' : 'warning',
      });
      return;
    }

    if (event.type === 'consultation:requested' || event.type === 'consultation:completed') {
      // Internal round-trip between the task cycle and the Architect loop — nothing a human
      // needs to see a log line for; consultation:question-asked below is the human-facing one.
      return;
    }

    if (event.type === 'consultation:question-asked') {
      entries.push({
        id,
        text: withTime(`Architect needs your input on ${event.taskId}`),
        tone: 'waiting',
      });
      return;
    }

    if (event.type === 'consultation:answered') {
      entries.push({
        id,
        text: withTime(
          event.skipped
            ? `Dismissed the Architect's question on ${event.taskId}`
            : `Replied to the Architect about ${event.taskId}`,
        ),
        tone: 'info',
      });
      return;
    }

    entries.push({ id, text: withTime(`Run moved to ${event.phase}`), tone: 'info' });
  });

  return entries;
}
