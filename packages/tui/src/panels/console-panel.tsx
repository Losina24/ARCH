import type { ArchMeshEvent } from '@losina/ipc';
import { Box, Text } from 'ink';
import { agentRoleColor, deriveAgentStatuses, workerSlotGroup } from '../agent-status.js';
import { AgentTranscript } from '../components/agent-transcript.js';
import { GradientText } from '../components/gradient-text.js';
import { LegendBox } from '../components/legend-box.js';
import { ACCENT, ERROR, MUTED, SELECTION_CURSOR, SUCCESS, WAITING } from '../theme.js';

interface ConsolePanelProps {
  events: ArchMeshEvent[];
  eventTimestamps?: number[];
  selectedAgentId: string | null;
  width: number;
}

const AGENT_LABEL_WIDTH = 12;
const LEFT_COLUMN_MIN_WIDTH = 28;
const LEFT_COLUMN_MAX_WIDTH = 40;
const LEFT_COLUMN_RATIO = 0.32;
const COLUMN_GAP = 2;

const CATEGORY_COLOR = {
  idle: MUTED,
  working: SUCCESS,
  blocked: ERROR,
  waiting: WAITING,
} as const;

export function ConsolePanel({
  events,
  eventTimestamps,
  selectedAgentId,
  width,
}: ConsolePanelProps) {
  const agents = deriveAgentStatuses(events);
  const selectedAgent = agents.find((agent) => agent.agentId === selectedAgentId);
  const transcriptAgentIds = selectedAgentId ? workerSlotGroup(events, selectedAgentId) : [];

  const leftWidth = Math.min(
    LEFT_COLUMN_MAX_WIDTH,
    Math.max(LEFT_COLUMN_MIN_WIDTH, Math.floor(width * LEFT_COLUMN_RATIO)),
  );
  const rightWidth = Math.max(0, width - leftWidth - COLUMN_GAP);

  return (
    <Box width={width}>
      <Box flexDirection="column" width={leftWidth} marginRight={COLUMN_GAP}>
        <LegendBox label="Agents" width={leftWidth}>
          {agents.length === 0 ? (
            <Text dimColor>No agents yet.</Text>
          ) : (
            <Box flexDirection="column">
              {agents.map((agent) => {
                const selected = agent.agentId === selectedAgentId;
                return (
                  <Text key={agent.agentId}>
                    <Text color={selected ? ACCENT : undefined}>
                      {selected ? `${SELECTION_CURSOR} ` : '  '}
                    </Text>
                    <Text bold color={agentRoleColor(agent.role)}>
                      {`${agent.label}:`.padEnd(AGENT_LABEL_WIDTH)}
                    </Text>
                    <Text color={CATEGORY_COLOR[agent.category]}>{agent.statusText}</Text>
                  </Text>
                );
              })}
            </Box>
          )}
        </LegendBox>
      </Box>

      <Box flexDirection="column" width={rightWidth}>
        <GradientText>Agent console</GradientText>
        <Box marginTop={1}>
          {!selectedAgentId ? (
            <Text dimColor>Select an agent to access its terminal.</Text>
          ) : (
            <AgentTranscript
              events={events}
              eventTimestamps={eventTimestamps}
              agentIds={transcriptAgentIds}
              agentLabel={selectedAgent?.label ?? selectedAgentId}
              width={rightWidth}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
