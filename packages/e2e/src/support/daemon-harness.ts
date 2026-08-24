import { getArchPaths } from '@losina/config';
import { type DaemonServerHandle, startDaemon } from '@losina/daemon';
import { ArchClient } from '@losina/daemon-client';

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
