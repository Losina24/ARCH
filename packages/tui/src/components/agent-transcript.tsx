import type {
  AgentActivityState,
  AgentRole,
  ArchMeshEvent,
  TaskStatusChangedEvent,
} from '@losina/ipc';
import { Box, Text } from 'ink';
import { formatTime, taskStatusLogText, taskStatusLogTone } from '../activity-log.js';
import { agentRoleColor } from '../agent-status.js';
import { ACTIVITY_HEADLINE, EMPHASIS, ERROR, MUTED, SUCCESS, WAITING, WARNING } from '../theme.js';
import { GradientBox } from './gradient-box.js';
import { Spinner } from './spinner.js';

interface AgentTranscriptProps {
  events: ArchMeshEvent[];
  eventTimestamps?: number[];
  /**
   * All agentIds whose entries should appear in this transcript. When a worker's numbered slot
   * has been reused across several tasks, this holds every agentId that slot has ever held, so
   * the transcript shows the slot's full history — not just its current occupant.
   */
  agentIds: string[];
  /**
   * Extra taskIds to include even if the agent has no matching `agent:activity` event for them
   * yet — e.g. a task that's blocked or cascade-failed before any worker ever picked it up.
   */
  taskIds?: string[];
  agentLabel: string;
  emptyMessage?: string;
  width?: number;
}

type TranscriptEntry =
  | { kind: 'dispatch'; index: number; taskId?: string }
  | { kind: 'lifecycle'; index: number; state: AgentActivityState; taskId?: string; tool?: string }
  | {
      kind: 'task-status';
      index: number;
      taskId: string;
      status: TaskStatusChangedEvent['status'];
      isResume: boolean;
      failureReason?: string;
    }
  | { kind: 'message'; index: number; role: AgentRole; taskId?: string; text: string }
  | {
      kind: 'human-prompt';
      index: number;
      taskId?: string;
      text: string;
      status: 'delivered' | 'processing';
    };

const TONE_COLOR = {
  info: MUTED,
  success: SUCCESS,
  warning: WARNING,
  error: ERROR,
  waiting: WAITING,
} as const;

function lifecycleText(
  state: AgentActivityState,
  taskId: string | undefined,
  tool: string | undefined,
): string {
  switch (state) {
    case 'spawning':
      return 'starting…';
    case 'using-tool':
      return tool ? `using ${tool}` : 'working…';
    case 'idle-waiting':
      return 'waiting';
    case 'completed':
      return taskId ? `finished · ${taskId}` : 'finished';
    case 'failed':
      return taskId ? `failed · ${taskId}` : 'failed';
    default:
      return state;
  }
}

function LifecycleGlyph({ state, isLatest }: { state: AgentActivityState; isLatest: boolean }) {
  if (isLatest && (state === 'spawning' || state === 'using-tool'))
    return <Spinner color="yellow" />;
  if (state === 'completed') return <Text color={SUCCESS}>✓</Text>;
  if (state === 'failed') return <Text color={ERROR}>✗</Text>;
  return <Text dimColor>⏸</Text>;
}

function buildEntries(
  events: ArchMeshEvent[],
  agentIds: string[],
  extraTaskIds: string[] = [],
): TranscriptEntry[] {
  const agentIdSet = new Set(agentIds);
  const taskIds = new Set<string>(extraTaskIds);
  for (const event of events) {
    if (event.type === 'agent:activity' && agentIdSet.has(event.agentId) && event.taskId) {
      taskIds.add(event.taskId);
    }
  }

  const entries: TranscriptEntry[] = [];
  const seenInProgress = new Set<string>();
  events.forEach((event, index) => {
    if (event.type === 'agent:activity' && agentIdSet.has(event.agentId)) {
      if (event.state === 'thinking') {
        if (event.viaHumanPrompt) {
          const pending = [...entries]
            .reverse()
            .find(
              (candidate): candidate is Extract<TranscriptEntry, { kind: 'human-prompt' }> =>
                candidate.kind === 'human-prompt' && candidate.status === 'delivered',
            );
          if (pending) {
            pending.status = 'processing';
            return;
          }
        }
        entries.push({ kind: 'dispatch', index, taskId: event.taskId });
      } else {
        entries.push({
          kind: 'lifecycle',
          index,
          state: event.state,
          taskId: event.taskId,
          tool: event.tool,
        });
      }
      return;
    }
    if (event.type === 'agent:message' && agentIdSet.has(event.agentId)) {
      entries.push({
        kind: 'message',
        index,
        role: event.role,
        taskId: event.taskId,
        text: event.text,
      });
      return;
    }
    if (event.type === 'human:prompt-sent' && agentIdSet.has(event.agentId)) {
      entries.push({
        kind: 'human-prompt',
        index,
        taskId: event.taskId,
        text: event.text,
        status: 'delivered',
      });
      return;
    }
    if (event.type === 'task:status-changed' && taskIds.has(event.taskId)) {
      const isResume = event.status === 'in_progress' && seenInProgress.has(event.taskId);
      if (event.status === 'in_progress') seenInProgress.add(event.taskId);
      entries.push({
        kind: 'task-status',
        index,
        taskId: event.taskId,
        status: event.status,
        isResume,
        failureReason: event.failureReason,
      });
    }
  });

  return entries;
}

/**
 * Chronological, timestamped view of one agent's turns: dispatch markers (never the actual
 * prompt text — only that one was sent), lifecycle events, task-status changes, and the
 * model's own literal message text for each completed turn.
 */
const DEFAULT_WIDTH = 60;

export function AgentTranscript({
  events,
  eventTimestamps = [],
  agentIds,
  taskIds,
  agentLabel,
  emptyMessage = 'No activity yet for this agent.',
  width = DEFAULT_WIDTH,
}: AgentTranscriptProps) {
  const entries = buildEntries(events, agentIds, taskIds);

  if (entries.length === 0) {
    return <Text dimColor>{emptyMessage}</Text>;
  }

  let lastLifecycleIndex = -1;
  for (const entry of entries) {
    if (entry.kind === 'lifecycle') lastLifecycleIndex = entry.index;
  }

  return (
    <Box flexDirection="column">
      {entries.map((entry) => {
        const timestamp = eventTimestamps[entry.index];
        const time =
          timestamp === undefined ? null : <Text color={MUTED}>{formatTime(timestamp)} </Text>;

        if (entry.kind === 'dispatch') {
          return (
            <Text key={entry.index} dimColor>
              {time}
              {'→ '}
              {entry.taskId ? `sent prompt · ${entry.taskId}` : 'sent prompt'}
            </Text>
          );
        }

        if (entry.kind === 'lifecycle') {
          return (
            <Text key={entry.index}>
              {time}
              <LifecycleGlyph state={entry.state} isLatest={entry.index === lastLifecycleIndex} />
              <Text dimColor> {lifecycleText(entry.state, entry.taskId, entry.tool)}</Text>
            </Text>
          );
        }

        if (entry.kind === 'task-status') {
          const text = taskStatusLogText(entry.status, entry.taskId, entry.isResume);
          if (!text) return null;
          const toneColor = TONE_COLOR[taskStatusLogTone(entry.status)];
          return (
            <Box key={entry.index} flexDirection="column">
              <Text color={toneColor}>
                {time}
                {text}
              </Text>
              {entry.failureReason && (
                <Box paddingLeft={2}>
                  <Text color={toneColor}>{entry.failureReason}</Text>
                </Box>
              )}
            </Box>
          );
        }

        if (entry.kind === 'human-prompt') {
          const statusText = entry.status === 'delivered' ? 'delivered' : 'processing…';
          return (
            <GradientBox key={entry.index} width={width}>
              <Box flexDirection="column">
                <Text>
                  {time}
                  <Text bold color={EMPHASIS}>
                    You
                  </Text>
                  <Text dimColor> ({statusText})</Text>
                </Text>
                <Text>{entry.text}</Text>
              </Box>
            </GradientBox>
          );
        }

        return (
          <Box key={entry.index} flexDirection="column">
            <Text>
              {time}
              <Text bold color={agentRoleColor(entry.role)}>
                {ACTIVITY_HEADLINE} {agentLabel}
              </Text>
            </Text>
            <Box paddingLeft={2}>
              <Text>{entry.text}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
