import type { ArchMeshEvent } from '@losina/ipc';
import { Box } from 'ink';
import { AgentTranscript } from '../components/agent-transcript.js';
import { GradientText } from '../components/gradient-text.js';
import { ScrollBox, type ScrollMetrics } from '../components/scroll-box.js';

interface ChatPanelProps {
  events: ArchMeshEvent[];
  eventTimestamps?: number[];
  architectAgentId: string;
  width: number;
  height: number;
  scrollOffset: number;
  onScrollMetrics: (metrics: ScrollMetrics) => void;
}

/**
 * Every review, consultation, and chat turn the Architect has ever taken part in for this run, in
 * one chronological feed — in practice "Console pre-filtered to the Architect, always available,
 * with a text box permanently on top" (see architect-chat-tab's plan). Reuses AgentTranscript as-is;
 * there is no chat-specific rendering here beyond wrapping it in a tail-following ScrollBox.
 */
export function ChatPanel({
  events,
  eventTimestamps,
  architectAgentId,
  width,
  height,
  scrollOffset,
  onScrollMetrics,
}: ChatPanelProps) {
  const transcriptHeight = Math.max(1, height - 2); // heading + margin above the transcript

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <GradientText>Chat with the Architect</GradientText>
      <Box marginTop={1}>
        <ScrollBox
          height={transcriptHeight}
          scrollOffset={scrollOffset}
          onContentHeight={(contentHeight) =>
            onScrollMetrics({ contentHeight, viewportHeight: transcriptHeight })
          }
        >
          <AgentTranscript
            events={events}
            eventTimestamps={eventTimestamps}
            agentIds={[architectAgentId]}
            agentLabel="Architect"
            emptyMessage="Ask the Architect anything about this run."
            width={width}
          />
        </ScrollBox>
      </Box>
    </Box>
  );
}
