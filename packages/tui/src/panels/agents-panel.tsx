import type { ArchMeshEvent } from '@losina/ipc';
import { Box } from 'ink';
import { agentRoleColor, deriveAgentStatuses } from '../agent-status.js';
import { AgentTranscript } from '../components/agent-transcript.js';
import { AgentsList } from '../components/agents-list.js';
import { ScrollBox, type ScrollMetrics } from '../components/scroll-box.js';

interface AgentsPanelProps {
  events: ArchMeshEvent[];
  eventTimestamps?: number[];
  width: number;
  height: number;
  scrollOffset: number;
  onScrollMetrics: (metrics: ScrollMetrics) => void;
}

/**
 * The "what's happening right now, across every agent" view: a compact status line per agent
 * (Architect included, explicitly "Waiting" when idle between reviews/consultations — no daemon
 * event needed for that, deriveAgentStatuses already infers it from the absence of one) on top,
 * then every agent's live activity interleaved into one chronological, attributed, auto-following
 * feed below — the same detail Console already shows for one agent at a time, extended to all of
 * them at once instead of requiring you to pick one.
 */
export function AgentsPanel({
  events,
  eventTimestamps,
  width,
  height,
  scrollOffset,
  onScrollMetrics,
}: AgentsPanelProps) {
  const agents = deriveAgentStatuses(events);
  const agentIds = agents.map((agent) => agent.agentId);
  const attribution = new Map(
    agents.map((agent) => [
      agent.agentId,
      { label: agent.label, color: agentRoleColor(agent.role) },
    ]),
  );

  // A fixed status header (however many agents there are right now) plus a margin line above the
  // scrollable feed below.
  const headerHeight = Math.max(1, agents.length) + 1;
  const feedHeight = Math.max(1, height - headerHeight);

  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      <Box flexDirection="column" height={headerHeight}>
        <AgentsList events={events} />
      </Box>
      <ScrollBox
        height={feedHeight}
        scrollOffset={scrollOffset}
        onContentHeight={(contentHeight) =>
          onScrollMetrics({ contentHeight, viewportHeight: feedHeight })
        }
      >
        <AgentTranscript
          events={events}
          eventTimestamps={eventTimestamps}
          agentIds={agentIds}
          agentLabel="Agent"
          attribution={attribution}
          emptyMessage="No activity yet."
          width={width}
        />
      </ScrollBox>
    </Box>
  );
}
