import { EventEmitter } from 'node:events';
import type { ArchMeshEvent } from '@arch/ipc';

export class RunEventBus {
  private readonly emitter = new EventEmitter();

  emit(event: ArchMeshEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(handler: (event: ArchMeshEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }
}
