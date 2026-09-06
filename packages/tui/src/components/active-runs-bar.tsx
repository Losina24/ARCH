import type { RunMeta } from '@losina/schemas';
import { Box, Text } from 'ink';
import { ACCENT, HEADING, WARNING } from '../theme.js';

/** Runs still in progress — every `RunPhase` except the two terminal ones. */
const ACTIVE_PHASES = ['grilling', 'definition', 'implementation'] as const;

const PHASE_COLOR: Record<(typeof ACTIVE_PHASES)[number], string> = {
  grilling: WARNING,
  definition: HEADING,
  implementation: ACCENT,
};

interface ActiveRunsBarProps {
  runs: RunMeta[];
  width: number;
}

/**
 * Top bar on the home screen listing every run whose phase isn't final (`done`/`blocked`) yet,
 * so a run left going in the background stays visible without opening it. Renders nothing when
 * there's no active run, so it takes no vertical space in that case.
 */
export function ActiveRunsBar({ runs, width }: ActiveRunsBarProps) {
  const activeRuns = runs.filter((run) =>
    (ACTIVE_PHASES as readonly string[]).includes(run.phase),
  );
  if (activeRuns.length === 0) return null;

  const entries = activeRuns.map((run) => ({
    run,
    text: `[${run.phase}] ${run.title}`,
  }));

  let shown = entries;
  let hiddenCount = 0;
  while (shown.length > 1) {
    const lineWidth = shown.reduce((sum, entry) => sum + entry.text.length + 3, -3);
    const suffixWidth = hiddenCount > 0 ? `  +${hiddenCount} more`.length : 0;
    if (lineWidth + suffixWidth <= width) break;
    hiddenCount += 1;
    shown = shown.slice(0, -1);
  }

  return (
    <Box>
      <Text>
        {shown.map((entry, index) => (
          <Text key={entry.run.runId}>
            {index > 0 && <Text dimColor> · </Text>}
            <Text color={PHASE_COLOR[entry.run.phase as (typeof ACTIVE_PHASES)[number]]}>
              [{entry.run.phase}]
            </Text>{' '}
            <Text>{entry.run.title}</Text>
          </Text>
        ))}
        {hiddenCount > 0 && <Text dimColor>  +{hiddenCount} more</Text>}
      </Text>
    </Box>
  );
}
