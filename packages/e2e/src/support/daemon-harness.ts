import { getArchPaths } from '@arch/config';
import { type DaemonServerHandle, startDaemon } from '@arch/daemon';
import { ArchClient } from '@arch/daemon-client';

export interface DaemonHarness {
  client: ArchClient;
  handle: DaemonServerHandle;
  stop: () => Promise<void>;
}

export async function startDaemonHarness(cwd: string): Promise<DaemonHarness> {
  const handle = await startDaemon(cwd);
  const { socketPath } = getArchPaths(cwd);
  const client = await ArchClient.connect(socketPath);

  return {
    client,
    handle,
    stop: async () => {
      client.close();
      await handle.close();
    },
  };
}
