import type { TaskStatus } from '@arch/schemas';
import { ERROR, MUTED, REVIEW, SUCCESS, WAITING } from './theme.js';

export interface TaskStyle {
  color: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
}

/**
 * Visual treatment for a task by status, shared between the Tasks list and
 * the DAG cards on the Execution page: done is green (task succeeded),
 * in_progress/in_review are amber (active work), failed is red, awaiting_human
 * is blue (paused for a human, not broken), and blocked stays the same
 * neutral gray as an untouched task — it hasn't failed, it's just waiting on
 * a dependency. Everything else stays neutral too.
 */
export function taskStyle(status: TaskStatus): TaskStyle {
  switch (status) {
    case 'done':
      return { color: SUCCESS };
    case 'in_progress':
      return { color: REVIEW, bold: true };
    case 'in_review':
      return { color: REVIEW };
    case 'failed':
      return { color: ERROR };
    case 'awaiting_human':
      return { color: WAITING };
    default:
      return { color: MUTED };
  }
}
