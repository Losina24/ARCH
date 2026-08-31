import { Box, Text } from 'ink';
import { GradientText } from '../components/gradient-text.js';
import { LegendBox } from '../components/legend-box.js';
import { MarkdownLite } from '../components/markdown-lite.js';

interface GrillingPanelProps {
  question: string;
  recommendation: string;
  width: number;
}

export function GrillingPanel({ question, recommendation, width }: GrillingPanelProps) {
  return (
    <Box flexDirection="column" width={width}>
      <Box marginBottom={1}>
        <GradientText>Grilling — defining the project</GradientText>
      </Box>
      <LegendBox label="Question" width={width}>
        <MarkdownLite text={question} />
      </LegendBox>
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
