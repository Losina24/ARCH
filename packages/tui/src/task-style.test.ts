import { describe, expect, it } from 'vitest';
import { taskStyle } from './task-style.js';
import { ERROR, MUTED, REVIEW, SUCCESS, WAITING } from './theme.js';

describe('taskStyle', () => {
  it('marks done tasks green', () => {
    expect(taskStyle('done')).toEqual({ color: SUCCESS });
  });

  it('highlights in_progress tasks amber, bold', () => {
    expect(taskStyle('in_progress')).toEqual({ color: REVIEW, bold: true });
  });

  it('marks in_review tasks amber', () => {
    expect(taskStyle('in_review')).toEqual({ color: REVIEW });
  });

  it('marks failed tasks red', () => {
    expect(taskStyle('failed')).toEqual({ color: ERROR });
  });

  it('marks awaiting_human tasks blue', () => {
    expect(taskStyle('awaiting_human')).toEqual({ color: WAITING });
  });

  it('keeps blocked tasks the neutral gray of an untouched task', () => {
    expect(taskStyle('blocked')).toEqual({ color: MUTED });
  });

  it('falls back to a neutral gray for every other status', () => {
    expect(taskStyle('pending')).toEqual({ color: MUTED });
    expect(taskStyle('ready')).toEqual({ color: MUTED });
    expect(taskStyle('needs_correction')).toEqual({ color: MUTED });
  });
});
