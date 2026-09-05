import { Box, Text } from 'ink';
import { GradientText } from '../components/gradient-text.js';
import { LegendBox } from '../components/legend-box.js';
import { MarkdownLite } from '../components/markdown-lite.js';

interface ConsultationPanelProps {
  taskId: string;
  failureReason: string;
  question: string;
  recommendation: string;
  /** Shown when more than one task has a question pending; the oldest is answered first. */
  extraCount?: number;
  width: number;
}

export function ConsultationPanel({
  taskId,
  failureReason,
  question,
  recommendation,
  extraCount = 0,
  width,
}: ConsultationPanelProps) {
  return (
    <Box flexDirection="column" width={width}>
      <Box marginBottom={1}>
        <GradientText>
          {`Architect — ${taskId} needs your input${extraCount > 0 ? ` (+${extraCount} more)` : ''}`}
        </GradientText>
      </Box>
      <LegendBox label="Why it stopped" width={width}>
        <MarkdownLite text={failureReason} />
      </LegendBox>
      <Box marginTop={1}>
        <LegendBox label="Question" width={width}>
          <MarkdownLite text={question} />
        </LegendBox>
      </Box>
      <Box marginTop={1}>
        <LegendBox label="Recommendation" width={width}>
          <MarkdownLite text={recommendation} />
        </LegendBox>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Answer freely, press Enter to accept the recommendation, or /skip.</Text>
      </Box>
    </Box>
  );
}
