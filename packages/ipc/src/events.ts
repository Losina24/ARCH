import type { RunPhase, TaskStatus } from '@losina/schemas';

export type AgentRole = 'architect' | 'worker';

export type AgentActivityState =
  | 'spawning'
  | 'thinking'
  | 'using-tool'
  | 'idle-waiting'
  | 'completed'
  | 'failed';

export interface RunStatusChangedEvent {
  type: 'run:status-changed';
  runId: string;
  phase: RunPhase;
}

export interface TaskStatusChangedEvent {
  type: 'task:status-changed';
  runId: string;
  taskId: string;
  status: TaskStatus;
  /** Only present when `status` is 'failed' or 'awaiting_human' — why the task was marked as such. */
  failureReason?: string;
}

export interface AgentActivityEvent {
  type: 'agent:activity';
  runId: string;
  agentId: string;
  role: AgentRole;
  taskId?: string;
  state: AgentActivityState;
  /** Sanitized provider-neutral activity, e.g. "Running tests"; never raw tool input/output. */
  detail?: string;
  tool?: string;
  file?: string;
  /** True when this dispatch carries a human's note (sent from the Console), not an automatic retry. */
  viaHumanPrompt?: boolean;
}

export interface AgentMessageEvent {
  type: 'agent:message';
  runId: string;
  agentId: string;
  role: AgentRole;
  taskId?: string;
  /** The model's own literal text for this turn (a worker's summary, an architect's verdict) — never the internal prompt sent to it. */
  text: string;
}

export interface ReviewRequestedEvent {
  type: 'review:requested';
  runId: string;
  taskId: string;
  seq: number;
  requestPath: string;
}

export interface ReviewCompletedEvent {
  type: 'review:completed';
  runId: string;
  taskId: string;
  seq: number;
  responsePath: string;
  approved: boolean;
}

export interface HumanPromptSentEvent {
  type: 'human:prompt-sent';
  runId: string;
  taskId: string;
  agentId: string;
  text: string;
}

export interface GrillingQuestionAskedEvent {
  type: 'grilling:question-asked';
  runId: string;
  seq: number;
  question: string;
  recommendation: string;
}

export interface GrillingAnsweredEvent {
  type: 'grilling:answered';
  runId: string;
  seq: number;
  answer?: string;
  skipped: boolean;
}

export type ArchMeshEvent =
  | RunStatusChangedEvent
  | TaskStatusChangedEvent
  | AgentActivityEvent
  | AgentMessageEvent
  | ReviewRequestedEvent
  | ReviewCompletedEvent
  | HumanPromptSentEvent
  | GrillingQuestionAskedEvent
  | GrillingAnsweredEvent;

/** One event as durably persisted to a run's event log, paired with when it was broadcast. */
export interface PersistedRunEvent {
  event: ArchMeshEvent;
  timestamp: number;
}
