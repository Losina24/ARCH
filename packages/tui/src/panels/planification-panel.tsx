import type { AgentActivityEvent, AgentRole } from '@losina/ipc';
import type { AgentMeshConfig, RunMeta, RunPlan } from '@losina/schemas';
import { Box, Text } from 'ink';
import { agentRoleColor } from '../agent-status.js';
import { GradientText } from '../components/gradient-text.js';
import { LegendBox } from '../components/legend-box.js';
import { MarkdownLite } from '../components/markdown-lite.js';
import { Spinner } from '../components/spinner.js';
import { ERROR, SUCCESS, WARNING } from '../theme.js';
import { truncateLines, wrapPlainText } from '../wrap-text.js';

interface PlanificationPanelProps {
  run: RunMeta;
  plan: RunPlan | null;
  planError: string | null;
  config: AgentMeshConfig | null;
  latestArchitectEvent: AgentActivityEvent | undefined;
  revising: boolean;
  width: number;
}

interface ArchitectStatus {
  message: string;
  color: string;
  spinner: boolean;
}

function liveActivityLabel(event: AgentActivityEvent): string | undefined {
  const detail =
    event.detail ??
    (event.state === 'using-tool' && event.tool ? `Using ${event.tool}` : undefined);
  if (!detail) return undefined;
  return event.file ? `${detail} · ${event.file}` : detail;
}

function architectStatus(
  run: RunMeta,
  plan: RunPlan | null,
  planError: string | null,
  latestEvent: AgentActivityEvent | undefined,
  revising: boolean,
): ArchitectStatus {
  if (planError) {
    return { message: `Failed to load the plan: ${planError}`, color: ERROR, spinner: false };
  }
  if (latestEvent?.state === 'failed') {
    return { message: 'The Architect agent failed.', color: ERROR, spinner: false };
  }
  if (run.phase !== 'definition' && run.phase !== 'grilling') {
    return { message: 'Planning finished.', color: SUCCESS, spinner: false };
  }
  if (revising) {
    // latestEvent can still hold the previous round's stale "completed" state
    // right after feedback is submitted, before the next spawning/thinking
    // event arrives — fall back to a generic label rather than showing that.
    const activity = latestEvent ? liveActivityLabel(latestEvent) : undefined;
    if (activity) return { message: `Architect · ${activity}…`, color: WARNING, spinner: true };
    const label =
      latestEvent && latestEvent.state !== 'completed'
        ? latestEvent.state.replace('-', ' ')
        : 'revising the plan';
    return { message: `Architect is ${label}…`, color: WARNING, spinner: true };
  }
  if (plan) {
    return {
      message: 'Plan ready — approve it or send more feedback.',
      color: SUCCESS,
      spinner: false,
    };
  }
  if (latestEvent) {
    const activity = liveActivityLabel(latestEvent);
    if (activity) {
      return { message: `Architect · ${activity}…`, color: WARNING, spinner: true };
    }
    return {
      message: `Architect is ${latestEvent.state.replace('-', ' ')}…`,
      color: WARNING,
      spinner: true,
    };
  }
  return { message: 'Waiting for the Architect agent to start…', color: WARNING, spinner: true };
}

const MODEL_ROLES: Array<{
  label: string;
  role: AgentRole;
  field: 'architectModel' | 'tlModel' | 'workerModel';
}> = [
  { label: 'Architect', role: 'architect', field: 'architectModel' },
  { label: 'TL', role: 'tl', field: 'tlModel' },
  { label: 'Worker', role: 'worker', field: 'workerModel' },
];

const MODEL_LABEL_WIDTH = 10;
const LEFT_COLUMN_MIN_WIDTH = 28;
const LEFT_COLUMN_MAX_WIDTH = 40;
const LEFT_COLUMN_RATIO = 0.32;
const COLUMN_GAP = 2;
// LegendBox chrome eating into its declared width: 1 border char + 1 padding char on each side.
const LEGEND_BOX_CHROME_WIDTH = 4;
const PROMPT_PREVIEW_MAX_LINES = 10;

function ModelsList({ config }: { config: AgentMeshConfig }) {
  return (
    <Box flexDirection="column">
      {MODEL_ROLES.map(({ label, role, field }) => (
        <Text key={field}>
          <Text bold color={agentRoleColor(role)}>
            {`${label}:`.padEnd(MODEL_LABEL_WIDTH)}
          </Text>
          <Text dimColor>{config.models[field]}</Text>
        </Text>
      ))}
    </Box>
  );
}

export function PlanificationPanel({
  run,
  plan,
  planError,
  config,
  latestArchitectEvent,
  revising,
  width,
}: PlanificationPanelProps) {
  const architect = architectStatus(run, plan, planError, latestArchitectEvent, revising);

  const leftWidth = Math.min(
    LEFT_COLUMN_MAX_WIDTH,
    Math.max(LEFT_COLUMN_MIN_WIDTH, Math.floor(width * LEFT_COLUMN_RATIO)),
  );

  const rightWidth = Math.max(0, width - leftWidth - COLUMN_GAP);

  const promptInnerWidth = Math.max(1, leftWidth - LEGEND_BOX_CHROME_WIDTH);
  const promptLines = truncateLines(
    wrapPlainText(run.prompt, promptInnerWidth),
    PROMPT_PREVIEW_MAX_LINES,
  );

  return (
    <Box width={width}>
      <Box flexDirection="column" width={leftWidth} marginRight={COLUMN_GAP}>
        <LegendBox label="Models" width={leftWidth}>
          {config ? <ModelsList config={config} /> : <Text dimColor>Loading configuration…</Text>}
        </LegendBox>
        <Box marginTop={1}>
          <LegendBox label="Prompt" width={leftWidth}>
            <Text>{promptLines.join('\n')}</Text>
          </LegendBox>
        </Box>
        <Box marginTop={1}>
          <LegendBox label="Tasks" width={leftWidth}>
            {plan && plan.tasksIndex.tasks.length > 0 ? (
              <Box flexDirection="column">
                {plan.tasksIndex.tasks.map((task) => (
                  <Text key={task.id}>
                    • <Text dimColor>[{task.id}]</Text> {task.title}
                  </Text>
                ))}
              </Box>
            ) : (
              <Text dimColor>Not ready yet.</Text>
            )}
          </LegendBox>
        </Box>
      </Box>

      <Box flexDirection="column" width={rightWidth}>
        <GradientText>{`Architect ${run.phase}`}</GradientText>
        <Box marginBottom={1}>
          {architect.spinner && (
            <Box marginRight={1}>
              <Spinner color={architect.color} />
            </Box>
          )}
          <Text
            color={architect.spinner ? undefined : architect.color}
            dimColor={architect.spinner}
          >
            {architect.message}
          </Text>
        </Box>

        <Text bold>Project brief</Text>
        {plan ? <MarkdownLite text={plan.projectMarkdown} /> : <Text dimColor>Not ready yet.</Text>}
      </Box>
    </Box>
  );
}
