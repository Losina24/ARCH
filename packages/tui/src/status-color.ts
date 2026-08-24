import type { TaskStatus } from '@losina/schemas';
import { ACCENT, ERROR, MUTED, REVIEW, SUCCESS, WAITING } from './theme.js';

export function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'done':
      return SUCCESS;
    case 'failed':
      return ERROR;
    case 'awaiting_human':
      return WAITING;
    case 'in_progress':
    case 'needs_correction':
      return REVIEW;
    case 'in_review':
    case 'ready':
      return ACCENT;
    default:
      return MUTED;
  }
}

export function statusGlyph(status: TaskStatus): string {
  switch (status) {
    case 'ready':
      return '◆';
    case 'blocked':
      return '⊘';
    case 'in_progress':
      return '◐';
    case 'in_review':
      return '◎';
    case 'needs_correction':
      return '✎';
    case 'done':
      return '✓';
    case 'failed':
      return '✗';
    case 'awaiting_human':
      return '⏳';
    default:
      return '○';
  }
}
