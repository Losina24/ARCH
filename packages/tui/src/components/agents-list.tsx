import type { ArchMeshEvent } from '@losina/ipc';
import { Box, Text } from 'ink';
import { agentRoleColor, deriveAgentStatuses } from '../agent-status.js';
import { ERROR, MUTED, SUCCESS, WAITING } from '../theme.js';

const AGENT_LABEL_WIDTH = 12;

const CATEGORY_COLOR = {
  idle: MUTED,
  working: SUCCESS,
  blocked: ERROR,
  waiting: WAITING,
} as const;

/**
 * One-line-per-agent status: the Architect first, then one entry per currently-occupied Worker
 * slot, each a role-colored label plus its current activity ("Waiting", "Editing file · TASK-004",
 * "Failed on TASK-002"...). Shared between the Monitor tab's compact sidebar and the Agents tab's
 * fuller header — see `deriveAgentStatuses` for exactly how each line's text is derived.
 */
export function AgentsList({ events }: { events: ArchMeshEvent[] }) {
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
