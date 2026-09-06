import type { ArchClient } from '@losina/daemon-client';
import type { ArchMeshEvent } from '@losina/ipc';

export function waitForEvent(
  client: ArchClient,
  predicate: (event: ArchMeshEvent) => boolean,
  timeoutMs = 30000,
): Promise<ArchMeshEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for a matching ARCH event`));
    }, timeoutMs);

    const unsubscribe = client.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}
