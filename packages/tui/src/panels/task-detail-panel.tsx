import { workerAgentId } from '@losina/core';
import type { ArchMeshEvent } from '@losina/ipc';
import type { Task } from '@losina/schemas';
import { Box, Text } from 'ink';
import { buildAgentLabels } from '../agent-status.js';
import { AgentTranscript } from '../components/agent-transcript.js';
import { LegendBox } from '../components/legend-box.js';
import { MarkdownLite } from '../components/markdown-lite.js';
import { ScrollBox, type ScrollMetrics, TailScrollBox } from '../components/scroll-box.js';
import { statusGlyph } from '../status-color.js';
import { taskStyle } from '../task-style.js';
import { ERROR } from '../theme.js';

interface TaskDetailPanelProps {
  task: Task;
  content: string | null;
  loading: boolean;
  error: string | null;
  events: ArchMeshEvent[];
  eventTimestamps?: number[];
  width: number;
  height: number;
  expanded: boolean;
  scrollOffset: number;
  onScrollMetrics: (metrics: ScrollMetrics) => void;
}

const COLUMN_GAP = 2;
const HEADER_ROWS_BASE = 3; // title line + status line + margin below
const FAILURE_REASON_ROWS = 1; // compact, truncated failure summary below the status

export function TaskDetailPanel({
  task,
  content,
  loading,
  error,
  events,
  eventTimestamps,
  width,
  height,
  expanded,
  scrollOffset,
  onScrollMetrics,
}: TaskDetailPanelProps) {
  const style = taskStyle(task.status);
  const agentId = workerAgentId(task.id);
  const agentLabel = buildAgentLabels(events).get(agentId) ?? 'Worker';

  const headerRows = HEADER_ROWS_BASE + (task.failureReason ? FAILURE_REASON_ROWS : 0);
  const columnsHeight = Math.max(3, height - headerRows);
  const paneViewportHeight = Math.max(1, columnsHeight - 2); // legend line + bottom border

  const leftWidth = expanded ? width : Math.floor((width - COLUMN_GAP) / 2);
  const rightWidth = Math.max(0, width - COLUMN_GAP - leftWidth);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text dimColor>[{task.id}]</Text> <Text bold>{task.title}</Text>
        </Text>
        <Text color={style.color}>
          {statusGlyph(task.status)} {task.status}
        </Text>
        {task.failureReason && (
          <Text color={ERROR} wrap="truncate-end">
            <Text bold>Failure reason:</Text> {task.failureReason}
          </Text>
        )}
      </Box>

      <Box width={width}>
        <Box width={leftWidth} marginRight={expanded ? 0 : COLUMN_GAP}>
          <LegendBox label="Console" width={leftWidth} height={columnsHeight}>
            {expanded ? (
              <ScrollBox
                height={paneViewportHeight}
                scrollOffset={scrollOffset}
                onContentHeight={(contentHeight) =>
                  onScrollMetrics({ contentHeight, viewportHeight: paneViewportHeight })
                }
              >
                <AgentTranscript
                  events={events}
                  eventTimestamps={eventTimestamps}
                  agentIds={[agentId]}
                  taskIds={[task.id]}
                  agentLabel={agentLabel}
                  emptyMessage="No activity yet for this task."
                  width={Math.max(0, leftWidth - 4)}
                />
              </ScrollBox>
            ) : (
              <TailScrollBox height={paneViewportHeight}>
                <AgentTranscript
                  events={events}
                  eventTimestamps={eventTimestamps}
                  agentIds={[agentId]}
                  taskIds={[task.id]}
                  agentLabel={agentLabel}
                  emptyMessage="No activity yet for this task."
                  width={Math.max(0, leftWidth - 4)}
                />
              </TailScrollBox>
            )}
          </LegendBox>
        </Box>

        {!expanded && (
          <Box flexDirection="column" width={rightWidth}>
            <LegendBox label="Task definition" width={rightWidth} height={columnsHeight}>
              <ScrollBox
                height={paneViewportHeight}
                scrollOffset={scrollOffset}
                onContentHeight={(contentHeight) =>
                  onScrollMetrics({ contentHeight, viewportHeight: paneViewportHeight })
                }
              >
                {error ? (
                  <Text color={ERROR}>Failed to load the task file: {error}</Text>
                ) : loading || content === null ? (
                  <Text dimColor>Loading task…</Text>
                ) : (
                  <MarkdownLite text={content} />
                )}
              </ScrollBox>
            </LegendBox>
          </Box>
        )}
      </Box>
    </Box>
  );
}
