import { CyclicDependencyError, UnknownDependencyError, topologicalWaves } from '@arch/core';
import type { AgentActivityEvent } from '@arch/ipc';
import type { Task, TasksIndex } from '@arch/schemas';
import { Box, Text } from 'ink';
import { latestAssignedAgent } from '../agent-status.js';
import { ACCENT, ERROR, INACTIVE } from '../theme.js';
import { COMPACT_CARD_WIDTH, TASK_CARD_WIDTH, TaskCard } from './task-card.js';

interface DagGraphProps {
  tasksIndex: TasksIndex | null;
  events: AgentActivityEvent[];
  agentLabels: Map<string, string>;
  width: number;
  selectedTaskId?: string | null;
}

const CARD_GAP = 2;

interface CardSlot {
  task: Task;
  center: number;
}

interface WaveLayout {
  rows: CardSlot[][];
  compact: boolean;
}

function fitsOneRow(count: number, cardWidth: number, width: number): boolean {
  return count * cardWidth + (count - 1) * CARD_GAP <= width;
}

/** Splits a wave into rows that fit `width` at a given card width, each row centered independently. */
function layoutRows(wave: Task[], width: number, cardWidth: number): CardSlot[][] {
  const perRow = Math.max(1, Math.floor((width + CARD_GAP) / (cardWidth + CARD_GAP)));
  const rows: CardSlot[][] = [];

  for (let start = 0; start < wave.length; start += perRow) {
    const rowTasks = wave.slice(start, start + perRow);
    const contentWidth = rowTasks.length * cardWidth + (rowTasks.length - 1) * CARD_GAP;
    const offset = Math.max(0, Math.floor((width - contentWidth) / 2));
    rows.push(
      rowTasks.map((task, index) => ({
        task,
        center: offset + index * (cardWidth + CARD_GAP) + Math.floor(cardWidth / 2),
      })),
    );
  }

  return rows;
}

/**
 * Lays out one wave, preferring full-size cards on a single row; falling
 * back to compact (title-less) cards — first to fit the wave on one row,
 * then, if the wave is too large even for that, wrapped across rows at the
 * compact width. Keeping waves on a single row whenever possible is what
 * keeps the graphical bus connector applicable at narrow terminal widths.
 */
function layoutWave(wave: Task[], width: number): WaveLayout {
  if (fitsOneRow(wave.length, TASK_CARD_WIDTH, width)) {
    return { rows: layoutRows(wave, width, TASK_CARD_WIDTH), compact: false };
  }
  return { rows: layoutRows(wave, width, COMPACT_CARD_WIDTH), compact: true };
}

function rowOffset(row: CardSlot[], cardWidth: number): number {
  return row[0].center - Math.floor(cardWidth / 2);
}

/**
 * Bus-style connector between two adjacent rows: a shared horizontal line
 * spanning the columns that actually have an edge between them, with a
 * vertical wire dropping into every card it touches. Always drawn between
 * the last row of the previous wave and the first row of the next — the
 * two rows physically adjacent to the connector gap — so a wave that had to
 * wrap into multiple rows still gets a real graphical connector rather than
 * losing its wiring. A dependency reaching past those two seam rows (skipping
 * an earlier wave entirely, or landing on a non-adjacent row of a wave that
 * itself wrapped) is not drawn — routing exact per-edge lines through
 * obstructing rows isn't worth the complexity for what's ultimately a
 * decorative graph view, and adaptive card sizing (see `layoutWave`) already
 * keeps this an edge case rather than the common one.
 */
interface ConnectorLine {
  key: string;
  line: string;
}

function buildConnector(prevRow: CardSlot[], nextRow: CardSlot[]): ConnectorLine[] | null {
  const prevIds = new Set(prevRow.map((slot) => slot.task.id));
  const parentCenters = new Set<number>();
  const childCenters = new Set<number>();

  for (const slot of nextRow) {
    const parents = slot.task.dependsOn.filter((dep) => prevIds.has(dep));
    if (parents.length === 0) continue;
    childCenters.add(slot.center);
    for (const dep of parents) {
      const parent = prevRow.find((candidate) => candidate.task.id === dep);
      if (parent) parentCenters.add(parent.center);
    }
  }

  if (parentCenters.size === 0 && childCenters.size === 0) return null;

  const allColumns = [...parentCenters, ...childCenters];
  const minColumn = Math.min(...allColumns);
  const maxColumn = Math.max(...allColumns);

  const top: string[] = new Array(maxColumn + 1).fill(' ');
  const bus: string[] = new Array(maxColumn + 1).fill(' ');
  const bottom: string[] = new Array(maxColumn + 1).fill(' ');

  for (let column = minColumn; column <= maxColumn; column += 1) {
    bus[column] = '─';
  }
  for (const column of parentCenters) {
    top[column] = '│';
    bus[column] = childCenters.has(column) ? '┼' : '┴';
  }
  for (const column of childCenters) {
    bottom[column] = '│';
    if (!parentCenters.has(column)) bus[column] = '┬';
  }

  return [
    { key: 'top', line: top.join('') },
    { key: 'bus', line: bus.join('') },
    { key: 'bottom', line: bottom.join('') },
  ];
}

/** Cyberpunk-styled DAG: one centered row of task cards per wave, wired together by neon connectors. */
export function DagGraph({
  tasksIndex,
  events,
  agentLabels,
  width,
  selectedTaskId = null,
}: DagGraphProps) {
  if (!tasksIndex) {
    return <Text dimColor>Task graph will appear here once the Architect finishes planning.</Text>;
  }

  if (tasksIndex.tasks.length === 0) {
    return <Text dimColor>The plan has no tasks.</Text>;
  }

  try {
    const waves = topologicalWaves(tasksIndex.tasks);
    const waveLayouts = waves.map((wave) => layoutWave(wave, width));

    return (
      <Box flexDirection="column">
        {waveLayouts.map((layout, waveIndex) => {
          const previous = waveIndex > 0 ? waveLayouts[waveIndex - 1] : null;
          const connector = previous
            ? buildConnector(previous.rows[previous.rows.length - 1], layout.rows[0])
            : null;
          const cardWidth = layout.compact ? COMPACT_CARD_WIDTH : TASK_CARD_WIDTH;

          return (
            <Box key={waves[waveIndex].map((task) => task.id).join('-')} flexDirection="column">
              {waveIndex > 0 &&
                (connector ? (
                  <Box flexDirection="column">
                    {connector.map(({ key, line }) => (
                      <Text key={key} color={ACCENT}>
                        {line}
                      </Text>
                    ))}
                  </Box>
                ) : (
                  <Box marginBottom={1}>
                    <Text color={INACTIVE}>▼</Text>
                  </Box>
                ))}
              {layout.rows.map((row, rowIndex) => (
                <Box
                  key={row.map((slot) => slot.task.id).join('-')}
                  marginLeft={rowOffset(row, cardWidth)}
                  columnGap={CARD_GAP}
                  marginBottom={rowIndex < layout.rows.length - 1 ? 1 : 0}
                >
                  {row.map((slot) => {
                    const agentId = latestAssignedAgent(events, slot.task.id);
                    const agentLabel = agentId ? (agentLabels.get(agentId) ?? agentId) : null;
                    return (
                      <TaskCard
                        key={slot.task.id}
                        task={slot.task}
                        agentLabel={agentLabel}
                        selected={slot.task.id === selectedTaskId}
                        compact={layout.compact}
                      />
                    );
                  })}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    );
  } catch (error) {
    if (error instanceof CyclicDependencyError || error instanceof UnknownDependencyError) {
      return <Text color={ERROR}>{error.message}</Text>;
    }
    throw error;
  }
}
