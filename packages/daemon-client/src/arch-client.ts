import type {
  ConfigGetRequest,
  ConfigSetRequest,
  DaemonShutdownRequest,
  PersistedRunEvent,
  RunAbortRequest,
  RunApproveRequest,
  RunCreateRequest,
  RunDeleteRequest,
  RunGetEventsRequest,
  RunGetPlanRequest,
  RunGetRequest,
  RunGetTaskFileRequest,
  RunListRequest,
  RunRefineRequest,
  RunRetryTaskRequest,
} from '@losina/ipc';
import type { AgentMeshConfig, RunMeta, RunPlan } from '@losina/schemas';
import { DaemonRpcClient, type EventHandler } from './rpc-client.js';

export class ArchClient {
  private constructor(private readonly rpc: DaemonRpcClient) {}

  static async connect(socketPath: string): Promise<ArchClient> {
    const rpc = await DaemonRpcClient.connect(socketPath);
    return new ArchClient(rpc);
  }

  createRun(payload: RunCreateRequest): Promise<RunMeta> {
    return this.rpc.request('run.create', payload);
  }

  listRuns(payload: RunListRequest = {}): Promise<RunMeta[]> {
    return this.rpc.request('run.list', payload);
  }

  getRun(payload: RunGetRequest): Promise<RunMeta> {
    return this.rpc.request('run.get', payload);
  }

  approveRun(payload: RunApproveRequest): Promise<RunMeta> {
    return this.rpc.request('run.approve', payload);
  }

  abortRun(payload: RunAbortRequest): Promise<RunMeta> {
    return this.rpc.request('run.abort', payload);
  }

  retryTask(payload: RunRetryTaskRequest): Promise<RunMeta> {
    return this.rpc.request('run.retryTask', payload);
  }

  deleteRun(payload: RunDeleteRequest): Promise<{ ok: boolean }> {
    return this.rpc.request('run.delete', payload);
  }

  refineRun(payload: RunRefineRequest): Promise<RunMeta> {
    return this.rpc.request('run.refine', payload);
  }

  getRunPlan(payload: RunGetPlanRequest): Promise<RunPlan | null> {
    return this.rpc.request('run.getPlan', payload);
  }

  getTaskFile(payload: RunGetTaskFileRequest): Promise<string | null> {
    return this.rpc.request('run.getTaskFile', payload);
  }

  getRunEvents(payload: RunGetEventsRequest): Promise<PersistedRunEvent[]> {
    return this.rpc.request('run.getEvents', payload);
  }

  getConfig(payload: ConfigGetRequest = {}): Promise<AgentMeshConfig> {
    return this.rpc.request('config.get', payload);
  }

  setConfig(payload: ConfigSetRequest): Promise<AgentMeshConfig> {
    return this.rpc.request('config.set', payload);
  }

  shutdownDaemon(payload: DaemonShutdownRequest = {}): Promise<{ ok: boolean }> {
    return this.rpc.request('daemon.shutdown', payload);
  }

  onEvent(handler: EventHandler): () => void {
    return this.rpc.onEvent(handler);
  }

  close(): void {
    this.rpc.close();
  }
}
