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

/** Internal: a task cycle asks the Architect to turn a stuck task into a human-facing question. */
export interface ConsultationRequestedEvent {
  type: 'consultation:requested';
  runId: string;
  taskId: string;
  seq: number;
  requestPath: string;
}

/** Internal: the Architect's reply to the above — the round-trip a task cycle blocks on. */
export interface ConsultationCompletedEvent {
  type: 'consultation:completed';
  runId: string;
  taskId: string;
  seq: number;
  /** Absent when the Architect wrote no question (protocol miss, crash, or timeout). */
  question?: string;
  recommendation?: string;
}

/**
 * Human-facing. Emitted only after the task's terminal status (failed/awaiting_human) is already
 * persisted and its worktree released, so a client reacting to this can immediately retryTask.
 */
export interface ConsultationQuestionAskedEvent {
  type: 'consultation:question-asked';
  runId: string;
  taskId: string;
  seq: number;
  question: string;
  recommendation: string;
  /** Same text as the task's failureReason — why it stopped, in the task cycle's own words. */
  failureReason: string;
}

export interface ConsultationAnsweredEvent {
  type: 'consultation:answered';
  runId: string;
  taskId: string;
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
  | GrillingAnsweredEvent
  | ConsultationRequestedEvent
  | ConsultationCompletedEvent
  | ConsultationQuestionAskedEvent
  | ConsultationAnsweredEvent;

/** One event as durably persisted to a run's event log, paired with when it was broadcast. */
export interface PersistedRunEvent {
  event: ArchMeshEvent;
  timestamp: number;
}
