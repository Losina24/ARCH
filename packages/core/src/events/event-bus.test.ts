import type { ArchMeshEvent } from '@arch/ipc';
import { describe, expect, it, vi } from 'vitest';
import { RunEventBus } from './event-bus.js';

const sampleEvent: ArchMeshEvent = { type: 'run:status-changed', runId: 'run-1', phase: 'done' };

describe('RunEventBus', () => {
  it('delivers an emitted event to a subscriber', () => {
    const bus = new RunEventBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    bus.emit(sampleEvent);

    expect(handler).toHaveBeenCalledWith(sampleEvent);
  });

  it('delivers events to every subscriber', () => {
    const bus = new RunEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe(first);
    bus.subscribe(second);

    bus.emit(sampleEvent);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering events after unsubscribe', () => {
    const bus = new RunEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(handler);

    unsubscribe();
    bus.emit(sampleEvent);

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not deliver events emitted before a subscription was created', () => {
    const bus = new RunEventBus();
    bus.emit(sampleEvent);
    const handler = vi.fn();
    bus.subscribe(handler);

    expect(handler).not.toHaveBeenCalled();
  });
});
