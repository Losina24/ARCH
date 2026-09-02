import type { AgentActivityEvent, ArchMeshEvent } from '@losina/ipc';
import type { RunPlan } from '@losina/schemas';
import { Box, Text } from 'ink';
import { buildActivityLog } from '../activity-log.js';
import { agentRoleColor, buildAgentLabels, deriveAgentStatuses } from '../agent-status.js';
import { DagGraph } from '../components/dag-graph.js';
import { GradientText } from '../components/gradient-text.js';
import { LegendBox } from '../components/legend-box.js';
import { ProgressBar } from '../components/progress-bar.js';
import { ScrollBox, type ScrollMetrics } from '../components/scroll-box.js';
import { ERROR, MUTED, SUCCESS, WAITING, WARNING } from '../theme.js';

interface ExecutionPanelProps {
  plan: RunPlan | null;
  events: ArchMeshEvent[];
  eventTimestamps?: number[];
  width: number;
  height: number;
  scrollOffset: number;
  onScrollMetrics: (metrics: ScrollMetrics) => void;
  selectedTaskId?: string | null;
}

const AGENT_LABEL_WIDTH = 12;
const LEFT_COLUMN_MIN_WIDTH = 28;
const LEFT_COLUMN_MAX_WIDTH = 40;
const LEFT_COLUMN_RATIO = 0.32;
const COLUMN_GAP = 2;
const MAX_LOG_ENTRIES = 8;

const CATEGORY_COLOR = {
  idle: MUTED,
  working: SUCCESS,
  blocked: ERROR,
  waiting: WAITING,
} as const;

const LOG_TONE_COLOR = {
  info: MUTED,
  success: SUCCESS,
  warning: WARNING,
  error: ERROR,
  waiting: WAITING,
} as const;

function AgentsList({ events }: { events: ArchMeshEvent[] }) {
  const agents = deriveAgentStatuses(events);

  return (
    <Box flexDirection="column">
      {agents.map((agent) => (
        <Text key={agent.agentId}>
          <Text bold color={agentRoleColor(agent.role)}>
            {`${agent.label}:`.padEnd(AGENT_LABEL_WIDTH)}
          </Text>
          <Text color={CATEGORY_COLOR[agent.category]}>{agent.statusText}</Text>
        </Text>
      ))}
    </Box>
  );
}

export function ExecutionPanel({
  plan,
  events,
  eventTimestamps,
  width,
  height,
  scrollOffset,
  onScrollMetrics,
  selectedTaskId = null,
}: ExecutionPanelProps) {
  const activityEvents = events.filter(
    (event): event is AgentActivityEvent => event.type === 'agent:activity',
  );
  const agentLabels = buildAgentLabels(events);
  const tasks = plan?.tasksIndex.tasks ?? [];
  // Oldest first, newest last — the most recent entry sits at the bottom of the log.
  const logEntries = buildActivityLog(events, eventTimestamps).slice(-MAX_LOG_ENTRIES);

  // Only successfully completed tasks count toward progress — a failed or
  // blocked task hasn't delivered anything, so it must not inflate the bar.
  const doneTasks = tasks.filter((task) => task.status === 'done').length;
  const hasFailedTasks = tasks.some((task) => task.status === 'failed');
  const hasAwaitingHuman = tasks.some((task) => task.status === 'awaiting_human');
  const progressRatio = tasks.length > 0 ? doneTasks / tasks.length : 0;
  const progressColor = hasFailedTasks ? ERROR : hasAwaitingHuman ? WAITING : SUCCESS;

  const leftWidth = Math.min(
    LEFT_COLUMN_MAX_WIDTH,
    Math.max(LEFT_COLUMN_MIN_WIDTH, Math.floor(width * LEFT_COLUMN_RATIO)),
  );

  const rightWidth = Math.max(0, width - leftWidth - COLUMN_GAP);
  const rightViewportHeight = Math.max(1, height - 2); // heading + margin above the viewport

  return (
    <Box width={width} height={height} overflow="hidden" alignItems="flex-start">
      <Box
        flexDirection="column"
        width={leftWidth}
        height={height}
        overflow="hidden"
        marginRight={COLUMN_GAP}
      >
        <LegendBox label="Agents" width={leftWidth}>
          <AgentsList events={events} />
        </LegendBox>
        <Box marginTop={1}>
          <LegendBox label="Progress" width={leftWidth}>
            {tasks.length > 0 ? (
              <ProgressBar ratio={progressRatio} width={leftWidth - 4} color={progressColor} />
            ) : (
              <Text dimColor>Not ready yet.</Text>
            )}
          </LegendBox>
        </Box>
        <Box marginTop={1}>
          <LegendBox label="Log" width={leftWidth}>
            {logEntries.length > 0 ? (
              <Box flexDirection="column">
                {logEntries.map((entry) => (
                  <Text key={entry.id} color={LOG_TONE_COLOR[entry.tone]}>
                    {entry.text}
                  </Text>
                ))}
              </Box>
            ) : (
              <Text dimColor>No activity yet.</Text>
            )}
          </LegendBox>
        </Box>
      </Box>

      <Box flexDirection="column" width={rightWidth} height={height} overflow="hidden">
        <GradientText>Project status</GradientText>
        <Box marginTop={1}>
          <ScrollBox
            height={rightViewportHeight}
            scrollOffset={scrollOffset}
            onContentHeight={(contentHeight) =>
              onScrollMetrics({ contentHeight, viewportHeight: rightViewportHeight })
            }
          >
            <DagGraph
              tasksIndex={plan?.tasksIndex ?? null}
              events={activityEvents}
              agentLabels={agentLabels}
              width={rightWidth}
              selectedTaskId={selectedTaskId}
            />
          </ScrollBox>
        </Box>
      </Box>
    </Box>
  );
}
