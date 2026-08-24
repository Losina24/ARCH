import type { ModelConfig } from '@losina/schemas';

export interface RunCreateRequest {
  prompt: string;
  cwd: string;
}

export type RunListRequest = Record<string, never>;

export interface RunGetRequest {
  runId: string;
}

export interface RunApproveRequest {
  runId: string;
}

export interface RunRefineRequest {
  runId: string;
  feedback: string;
}

export interface RunGetPlanRequest {
  runId: string;
}

export interface RunGetEventsRequest {
  runId: string;
}

export interface RunGetTaskFileRequest {
  runId: string;
  file: string;
}

export interface RunAbortRequest {
  runId: string;
}

export interface RunRetryTaskRequest {
  runId: string;
  taskId: string;
  message: string;
}

export interface RunDeleteRequest {
  runId: string;
}

export type DaemonShutdownRequest = Record<string, never>;

export type ConfigGetRequest = Record<string, never>;

export interface ConfigSetRequest {
  models?: Partial<ModelConfig>;
  maxConcurrency?: number;
  maxRetries?: number;
  useWorktrees?: boolean;
}
