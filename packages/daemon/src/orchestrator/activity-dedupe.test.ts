import { describe, expect, it } from 'vitest';
import { createActivityDeduper } from './activity-dedupe.js';

describe('createActivityDeduper', () => {
  it('allows the first report of any state', () => {
    const changed = createActivityDeduper();
    expect(changed('idle-waiting')).toBe(true);
  });

  it('suppresses immediate repeats of the same state with no taskId', () => {
    const changed = createActivityDeduper();
    expect(changed('idle-waiting')).toBe(true);
    expect(changed('idle-waiting')).toBe(false);
    expect(changed('idle-waiting')).toBe(false);
  });

  it('suppresses immediate repeats of the same state for the same taskId', () => {
    const changed = createActivityDeduper();
    expect(changed('thinking', 'TASK-001')).toBe(true);
    expect(changed('thinking', 'TASK-001')).toBe(false);
  });

  it('allows a transition to a different state', () => {
    const changed = createActivityDeduper();
    expect(changed('thinking')).toBe(true);
    expect(changed('idle-waiting')).toBe(true);
  });

  it('allows the same state for a different taskId', () => {
    const changed = createActivityDeduper();
    expect(changed('thinking', 'TASK-001')).toBe(true);
    expect(changed('thinking', 'TASK-002')).toBe(true);
  });

  it('allows re-announcing a state after an intervening different state', () => {
    const changed = createActivityDeduper();
    expect(changed('idle-waiting')).toBe(true);
    expect(changed('thinking', 'TASK-001')).toBe(true);
    expect(changed('idle-waiting')).toBe(true);
  });
});
