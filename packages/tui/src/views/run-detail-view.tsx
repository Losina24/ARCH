import type { ArchClient } from '@losina/daemon-client';
import type { AgentActivityEvent, ArchMeshEvent } from '@losina/ipc';
import type { AgentMeshConfig, RunMeta, RunPlan, Task } from '@losina/schemas';
import { Box, type DOMElement, Text, measureElement, useInput } from 'ink';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deriveAgentStatuses } from '../agent-status.js';
import { type SlashCommand, isCommand, matchCommands } from '../commands.js';
import { type CommandHint, CommandHints } from '../components/command-hints.js';
import { CommandSuggestions } from '../components/command-suggestions.js';
import { GradientText } from '../components/gradient-text.js';
import { ScrollBox, type ScrollMetrics } from '../components/scroll-box.js';
import { StatusBar } from '../components/status-bar.js';
import { useTerminalColumns } from '../hooks/use-terminal-columns.js';
import { useTerminalRows } from '../hooks/use-terminal-rows.js';
import {
  ArchitectConversationInput,
  type ConversationMode,
} from '../panels/architect-conversation-input.js';
import { ConsolePanel } from '../panels/console-panel.js';
import { ConsultationPanel } from '../panels/consultation-panel.js';
import { ExecutionPanel } from '../panels/execution-panel.js';
import { GrillingPanel } from '../panels/grilling-panel.js';
import { PlanificationPanel } from '../panels/planification-panel.js';
import { TaskDetailPanel } from '../panels/task-detail-panel.js';
import { ERROR, INACTIVE, MUTED, SUCCESS, WAITING, WARNING } from '../theme.js';

const TABS = ['planification', 'overview', 'console'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  planification: 'Overview',
  overview: 'Monitor',
  console: 'Console',
};

const HEADER_MARGIN = 6;
const HEADER_LABEL = 'ARCH Terminal';
const MIN_TITLE_GAP = 14;
const SCROLL_STEP = 3;

// The commands the Architect conversation box recognizes, for the live suggestions dropdown —
// see submitFeedback/submitGrillingAnswer/submitConsultationReply below for what they actually do.
const DEFINITION_COMMANDS: SlashCommand[] = [
  { name: 'approve', description: 'Approve the plan and start the run' },
  { name: 'abort', description: 'Abort the run' },
];
const SKIP_COMMAND: SlashCommand[] = [
  { name: 'skip', description: 'Skip this question and move on' },
];

// Row budget so the whole view never exceeds the terminal height — header and
// footer stay pinned, and only the body scrolls internally. The header is a
// fixed height (its title is truncated to fit, never wraps), but the footer's
// height is measured for real: command hints, the status message, and the
// Architect conversation input (which grows up to 3 lines of typed or pasted
// text, see MultilineTextInput's MAX_VISIBLE_ROWS) can each render taller
// than a single line depending on their content and the terminal's width, so
// a fixed row count for them would eventually under-reserve space, push the
// total output height to (or past) the terminal's row count, and trip Ink 5's
// full-screen clear-and-redraw path below — visible as flicker concentrated
// at the bottom of the screen.
const HEADER_ROWS = 5; // top margin + title/tab-bar line + margin + divider line + margin
const MIN_BODY_ROWS = 3;
// Ink 5 clears the entire terminal whenever rendered output is as tall as the TTY. Keeping one
// row unused makes animated frames use its normal cursor-based redraw path instead.
const RENDER_HEADROOM_ROWS = 1;

interface ConsultationState {
  taskId: string;
  seq: number;
  question: string;
  recommendation: string;
  failureReason: string;
}

function tabText(candidate: Tab, active: Tab): string {
  return candidate === active ? `› ${TAB_LABELS[candidate]} ‹` : `  ${TAB_LABELS[candidate]}  `;
}

function TabBar({ tab }: { tab: Tab }) {
  return (
    <Box>
      {TABS.map((candidate, index) => (
        <Text key={candidate}>
          {index > 0 && <Text> </Text>}
          {candidate === tab ? (
            <Text>
              <Text color={MUTED}>{'› '}</Text>
              <Text bold>{TAB_LABELS[candidate]}</Text>
              <Text color={MUTED}>{' ‹'}</Text>
            </Text>
          ) : (
            <Text color={INACTIVE}>{`  ${TAB_LABELS[candidate]}  `}</Text>
          )}
        </Text>
      ))}
    </Box>
  );
}

function statusLabel(
  busy: boolean,
  waitingForArchitect: boolean,
): { label: string; color: string } {
  if (busy) return { label: 'Sending…', color: WARNING };
  if (waitingForArchitect) return { label: 'Waiting for model', color: WARNING };
  return { label: 'Ready', color: SUCCESS };
}

function truncateTitle(title: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (title.length <= maxWidth) return title;
  return `${title.slice(0, Math.max(0, maxWidth - 1))}…`;
}

interface RunDetailViewProps {
  client: ArchClient;
  run: RunMeta;
  onBack: () => void;
}

export function RunDetailView({ client, run: initialRun, onBack }: RunDetailViewProps) {
  const [run, setRun] = useState<RunMeta>(initialRun);
  const [tab, setTab] = useState<Tab>('planification');
  const [events, setEvents] = useState<ArchMeshEvent[]>([]);
  const [eventTimestamps, setEventTimestamps] = useState<number[]>([]);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [config, setConfig] = useState<AgentMeshConfig | null>(null);
  const [revising, setRevising] = useState(false);
  const [grillingQuestion, setGrillingQuestion] = useState<{
    seq: number;
    question: string;
    recommendation: string;
  } | null>(null);
  const [consultations, setConsultations] = useState<Map<string, ConsultationState>>(new Map());
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>({
    contentHeight: 0,
    viewportHeight: 1,
  });
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const [taskSelectMode, setTaskSelectMode] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [taskFileContent, setTaskFileContent] = useState<string | null>(null);
  const [taskFileLoading, setTaskFileLoading] = useState(false);
  const [taskFileError, setTaskFileError] = useState<string | null>(null);
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [agentSelectMode, setAgentSelectMode] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [taskConsoleExpanded, setTaskConsoleExpanded] = useState(false);

  // The live subscription below has no history — a run that's already blocked/done by the time
  // this view mounts (e.g. navigating Home then back) will never emit another event, so `events`
  // would stay empty forever without this. hydratedRef/pendingLiveEventsRef exist so live events
  // arriving before the persisted history finishes loading are buffered instead of lost or applied
  // out of order relative to that history.
  const hydratedRef = useRef(false);
  const pendingLiveEventsRef = useRef<{ event: ArchMeshEvent; timestamp: number }[]>([]);
  const followScrollTailRef = useRef(false);
  const lastSurfacedConsultationRef = useRef<string | null>(null);

  const tasks = plan?.tasksIndex.tasks ?? [];
  const selectedTask = tasks[selectedTaskIndex] ?? null;
  const liveOpenTask = openTask
    ? (tasks.find((task) => task.id === openTask.id) ?? openTask)
    : null;

  useEffect(() => {
    setSelectedTaskIndex((index) => Math.min(index, Math.max(0, tasks.length - 1)));
  }, [tasks.length]);

  useEffect(() => {
    if (!openTask) return;
    setTaskFileContent(null);
    setTaskFileError(null);
    setTaskFileLoading(true);
    client
      .getTaskFile({ runId: run.runId, file: openTask.file })
      .then(setTaskFileContent)
      .catch((error: Error) => setTaskFileError(error.message))
      .finally(() => setTaskFileLoading(false));
  }, [client, run.runId, openTask]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets task-console UI state whenever a different task is opened, not on any other value read inside
  useEffect(() => {
    setTaskConsoleExpanded(false);
  }, [openTask?.id]);

  useEffect(() => {
    client
      .getRunPlan({ runId: run.runId })
      .then((result) => {
        setPlan(result);
        setPlanError(null);
      })
      .catch((error: Error) => setPlanError(error.message));
  }, [client, run.runId]);

  useEffect(() => {
    client
      .getConfig()
      .then(setConfig)
      .catch(() => {});
  }, [client]);

  useEffect(() => {
    return client.onEvent((event) => {
      if (!('runId' in event) || event.runId !== run.runId) return;
      const timestamp = Date.now();
      if (hydratedRef.current) {
        setEvents((previous) => [...previous, event]);
        setEventTimestamps((previous) => [...previous, timestamp]);
      } else {
        pendingLiveEventsRef.current.push({ event, timestamp });
      }

      if (event.type === 'run:status-changed') {
        setRun((previous) => ({ ...previous, phase: event.phase }));
      }

      if (event.type === 'task:status-changed') {
        setPlan((previous) => {
          if (!previous) return previous;
          const tasks = previous.tasksIndex.tasks.map((task) =>
            task.id === event.taskId ? { ...task, status: event.status } : task,
          );
          return { ...previous, tasksIndex: { ...previous.tasksIndex, tasks } };
        });
        // A task leaving failed/awaiting_human (retried, or resolved some other way) clears any
        // consultation shown for it — robust to a daemon restart, where the in-memory
        // consultation:answered event this normally rides on would never arrive.
        if (event.status !== 'failed' && event.status !== 'awaiting_human') {
          setConsultations((previous) => {
            if (!previous.has(event.taskId)) return previous;
            const next = new Map(previous);
            next.delete(event.taskId);
            return next;
          });
        }
      }

      if (event.type === 'agent:activity' && event.role === 'architect') {
        if (event.state === 'completed') {
          client
            .getRunPlan({ runId: run.runId })
            .then((result) => {
              setPlan(result);
              setPlanError(null);
              setStatus('');
            })
            .catch((error: Error) => setPlanError(error.message))
            .finally(() => setRevising(false));
        } else if (event.state === 'failed') {
          setRevising(false);
        }
      }

      if (event.type === 'grilling:question-asked') {
        setGrillingQuestion({
          seq: event.seq,
          question: event.question,
          recommendation: event.recommendation,
        });
      }

      if (event.type === 'grilling:answered') {
        setGrillingQuestion(null);
      }

      if (event.type === 'consultation:question-asked') {
        setConsultations((previous) => {
          const next = new Map(previous);
          next.set(event.taskId, {
            taskId: event.taskId,
            seq: event.seq,
            question: event.question,
            recommendation: event.recommendation,
            failureReason: event.failureReason,
          });
          return next;
        });
      }

      if (event.type === 'consultation:answered') {
        setConsultations((previous) => {
          if (!previous.has(event.taskId)) return previous;
          const next = new Map(previous);
          next.delete(event.taskId);
          return next;
        });
      }
    });
  }, [client, run.runId]);

  // Runs after the live subscription above is already active, so any event broadcast while this
  // fetch is in flight lands in pendingLiveEventsRef instead of being missed. Draining that buffer
  // once the history resolves (success or failure) is what lets hydratedRef flip to direct-append
  // mode without a gap.
  useEffect(() => {
    hydratedRef.current = false;
    pendingLiveEventsRef.current = [];

    const drainBuffered = () => {
      const buffered = pendingLiveEventsRef.current;
      pendingLiveEventsRef.current = [];
      hydratedRef.current = true;
      return buffered;
    };

    client
      .getRunEvents({ runId: run.runId })
      .then((history) => {
        const buffered = drainBuffered();
        const allEvents = [
          ...history.map((entry) => entry.event),
          ...buffered.map((entry) => entry.event),
        ];
        setEvents(allEvents);
        setEventTimestamps([
          ...history.map((entry) => entry.timestamp),
          ...buffered.map((entry) => entry.timestamp),
        ]);

        let lastQuestion: { seq: number; question: string; recommendation: string } | null = null;
        const hydratedConsultations = new Map<string, ConsultationState>();
        for (const event of allEvents) {
          if (event.type === 'grilling:question-asked') {
            lastQuestion = {
              seq: event.seq,
              question: event.question,
              recommendation: event.recommendation,
            };
          } else if (event.type === 'grilling:answered') {
            lastQuestion = null;
          } else if (event.type === 'consultation:question-asked') {
            hydratedConsultations.set(event.taskId, {
              taskId: event.taskId,
              seq: event.seq,
              question: event.question,
              recommendation: event.recommendation,
              failureReason: event.failureReason,
            });
          } else if (event.type === 'consultation:answered') {
            hydratedConsultations.delete(event.taskId);
          } else if (
            event.type === 'task:status-changed' &&
            event.status !== 'failed' &&
            event.status !== 'awaiting_human'
          ) {
            hydratedConsultations.delete(event.taskId);
          }
        }
        setGrillingQuestion(lastQuestion);
        setConsultations(hydratedConsultations);
      })
      .catch(() => {
        const buffered = drainBuffered();
        setEvents((previous) => [...previous, ...buffered.map((entry) => entry.event)]);
        setEventTimestamps((previous) => [
          ...previous,
          ...buffered.map((entry) => entry.timestamp),
        ]);
      });
  }, [client, run.runId]);

  const architectEvents = events.filter(
    (event): event is AgentActivityEvent =>
      event.type === 'agent:activity' && event.role === 'architect',
  );
  const latestArchitectEvent = architectEvents[architectEvents.length - 1];
  const architectFailed = latestArchitectEvent?.state === 'failed';
  const waitingForArchitect = run.phase === 'definition' && !architectFailed && (!plan || revising);

  const agents = deriveAgentStatuses(events);

  useEffect(() => {
    setSelectedAgentIndex((index) => Math.min(index, Math.max(0, agents.length - 1)));
  }, [agents.length]);

  // Oldest-pending-first: Map iteration order is insertion order, and an update (re-asking for
  // the same task) uses the same key, so a task's position never moves just because its question
  // changed — only actually resolving it (delete) and later triggering a new one moves it to the
  // back of the queue.
  const pendingConsultation = consultations.size > 0 ? [...consultations.values()][0] : null;

  const conversationMode: ConversationMode | null = openTask
    ? null
    : run.phase === 'definition'
      ? 'definition'
      : run.phase === 'grilling' && grillingQuestion
        ? 'grilling'
        : pendingConsultation
          ? 'consultation'
          : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: clears the shared draft whenever what it's a draft *for* changes, not on any value read inside
  useEffect(() => {
    setDraft('');
  }, [conversationMode, pendingConsultation?.taskId]);

  // The commands each conversation mode actually recognizes (see submitFeedback/
  // submitGrillingAnswer/submitConsultationReply above) — used only to drive the live
  // suggestions dropdown, never to decide what a submitted command does.
  const conversationCommands: SlashCommand[] =
    conversationMode === 'definition' ? DEFINITION_COMMANDS : conversationMode ? SKIP_COMMAND : [];
  const commandSuggestions = matchCommands(draft, conversationCommands);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets the command-menu highlight whenever the typed text changes, not on any value read inside
  useEffect(() => {
    setSuggestionIndex(0);
  }, [draft]);

  // Auto-switches to the Overview tab the first time a given consultation surfaces, so it's
  // visible without the human having to notice it and navigate manually — but only once per
  // question, and never while a task detail page is open (openTask hides the conversation
  // entirely, see conversationMode above). If a question arrives while one is open, the switch
  // still happens once it's closed, since the ref is only marked once the switch actually runs.
  useEffect(() => {
    if (!pendingConsultation || openTask) return;
    const key = `${pendingConsultation.taskId}:${pendingConsultation.seq}`;
    if (lastSurfacedConsultationRef.current === key) return;
    lastSurfacedConsultationRef.current = key;
    setTab('planification');
  }, [pendingConsultation, openTask]);

  const approve = async () => {
    setBusy(true);
    setStatus('Approving…');
    try {
      const updated = await client.approveRun({ runId: run.runId });
      setRun(updated);
      setStatus('');
      setTab('overview');
    } catch (error) {
      setStatus(`Failed to approve: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const abort = async () => {
    setBusy(true);
    setStatus('Aborting…');
    try {
      const updated = await client.abortRun({ runId: run.runId });
      setRun(updated);
      setStatus('Abort requested.');
    } catch (error) {
      setStatus(`Failed to abort: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;

    if (isCommand(trimmed, 'approve')) {
      setDraft('');
      await approve();
      return;
    }
    if (isCommand(trimmed, 'abort')) {
      setDraft('');
      await abort();
      return;
    }

    if (waitingForArchitect) {
      setStatus('Please wait for the Architect to finish before sending more feedback.');
      return;
    }

    setBusy(true);
    setStatus('Sending feedback to the Architect…');
    try {
      const updated = await client.refineRun({ runId: run.runId, feedback: trimmed });
      setRun(updated);
      setDraft('');
      setRevising(true);
      setStatus('Feedback sent — revising the plan.');
    } catch (error) {
      setStatus(`Failed to refine: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const submitGrillingAnswer = async (value: string) => {
    if (busy) return;
    const trimmed = value.trim();

    if (isCommand(trimmed, 'skip') || isCommand(trimmed, 'done')) {
      setBusy(true);
      setStatus('Skipping the remaining questions…');
      try {
        const updated = await client.answerGrillingQuestion({ runId: run.runId, skip: true });
        setRun(updated);
        setDraft('');
        setStatus('');
      } catch (error) {
        setStatus(`Failed to skip: ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    const answer = trimmed || grillingQuestion?.recommendation;
    if (!answer) return;

    setBusy(true);
    setStatus('Sending your answer to the Architect…');
    try {
      const updated = await client.answerGrillingQuestion({ runId: run.runId, answer });
      setRun(updated);
      setDraft('');
      setStatus('');
    } catch (error) {
      setStatus(`Failed to send the answer: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const submitConsultationReply = async (value: string, consultation: ConsultationState) => {
    if (busy) return;
    const trimmed = value.trim();

    if (isCommand(trimmed, 'skip')) {
      setBusy(true);
      setStatus("Dismissing the Architect's question…");
      try {
        const updated = await client.dismissConsultation({
          runId: run.runId,
          taskId: consultation.taskId,
        });
        setRun(updated);
        setDraft('');
        setStatus('');
      } catch (error) {
        setStatus(`Failed to dismiss: ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Enter on an empty reply accepts the Architect's own recommendation, same convention as
    // grilling. Whatever the reply ends up being, it goes straight to retryTask verbatim — no
    // second Architect call translates it first, see escalateToHuman in tl-loop.ts.
    const reply = trimmed || consultation.recommendation;
    if (!reply) return;

    setBusy(true);
    setStatus('Sending your reply to the agent…');
    try {
      const updated = await client.retryTask({
        runId: run.runId,
        taskId: consultation.taskId,
        message: reply,
      });
      setRun(updated);
      setDraft('');
      setStatus('Reply sent — resuming the agent.');
    } catch (error) {
      setStatus(`Failed to send the reply: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const submitConversation = async (rawValue: string) => {
    // Same convention as the home screen's command dropdown: a typed prefix that doesn't exactly
    // match a recognized command, but the suggestions dropdown has candidates for it, resolves to
    // whichever one is arrow-key-highlighted — so "/app" + Enter runs /approve instead of being
    // sent to the Architect as literal feedback.
    const isExactCommand = conversationCommands.some((command) =>
      isCommand(rawValue, command.name),
    );
    const value =
      !isExactCommand && commandSuggestions.length > 0
        ? `/${commandSuggestions[Math.min(suggestionIndex, commandSuggestions.length - 1)]?.name ?? ''}`
        : rawValue;

    if (conversationMode === 'definition') {
      await submitFeedback(value);
    } else if (conversationMode === 'grilling') {
      await submitGrillingAnswer(value);
    } else if (conversationMode === 'consultation' && pendingConsultation) {
      await submitConsultationReply(value, pendingConsultation);
    }
  };

  const consoleDisplayedAgentId = agentSelectMode
    ? (agents[selectedAgentIndex]?.agentId ?? null)
    : selectedAgentId;
  const hasFailedTask = tasks.some((task) => task.status === 'failed');
  const hasAwaitingHumanTask = tasks.some((task) => task.status === 'awaiting_human');
  const showBlockedMessage =
    liveOpenTask === null && tab === 'overview' && (hasFailedTask || hasAwaitingHumanTask);

  const columns = useTerminalColumns();
  const rows = useTerminalRows();
  const width = Math.max(20, columns - 2);

  const footerRef = useRef<DOMElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);

  const bodyHeight = Math.max(
    MIN_BODY_ROWS,
    rows - HEADER_ROWS - footerHeight - RENDER_HEADROOM_ROWS,
  );

  // Measures the footer's true rendered height after every render (mirroring how ScrollBox
  // measures body content, see scroll-box.tsx), instead of assuming a fixed row count per
  // section. Unlike ScrollBox's own measurement (which only refines scroll-clamping math
  // inside a box whose height is already fixed), this one feeds straight back into
  // `bodyHeight` itself — a stale measurement doesn't just misreport, it makes the *next*
  // render's total output taller than the terminal, which is exactly the condition that
  // trips Ink 5's full-screen clear. useLayoutEffect (rather than useEffect) corrects it
  // synchronously, before Ink flushes the frame, so the oversized intermediate render is
  // never actually written to the terminal — only the corrected one is.
  useLayoutEffect(() => {
    if (!footerRef.current) return;
    const measured = measureElement(footerRef.current).height;
    setFooterHeight((current) => (current === measured ? current : measured));
  });
  const maxScrollOffset = Math.max(0, scrollMetrics.contentHeight - scrollMetrics.viewportHeight);
  const scrollPageSize = Math.max(1, scrollMetrics.viewportHeight);
  const scrollContextKey = liveOpenTask
    ? `task:${liveOpenTask.id}:${taskConsoleExpanded ? 'console' : 'definition'}`
    : tab === 'console'
      ? `agent:${consoleDisplayedAgentId ?? 'none'}`
      : tab;
  const shouldFollowScrollTail =
    (liveOpenTask !== null && taskConsoleExpanded) ||
    (liveOpenTask === null && tab === 'console' && consoleDisplayedAgentId !== null);

  const reportScrollMetrics = (metrics: ScrollMetrics) => {
    const normalized = {
      contentHeight: Math.max(0, metrics.contentHeight),
      viewportHeight: Math.max(1, metrics.viewportHeight),
    };
    const nextMaxOffset = Math.max(0, normalized.contentHeight - normalized.viewportHeight);
    setScrollMetrics((previous) =>
      previous.contentHeight === normalized.contentHeight &&
      previous.viewportHeight === normalized.viewportHeight
        ? previous
        : normalized,
    );
    setScrollOffset((offset) =>
      followScrollTailRef.current ? nextMaxOffset : Math.min(offset, nextMaxOffset),
    );
  };

  useEffect(() => {
    setScrollOffset((offset) => Math.min(offset, maxScrollOffset));
  }, [maxScrollOffset]);

  // Every distinct pane gets its own natural starting edge. Logs open at the tail; plans, DAGs,
  // and task definitions open at the top. reportScrollMetrics catches the later measurement of a
  // freshly mounted pane and completes the tail jump without relying on stale dimensions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollContextKey fully identifies the active pane; live size changes are handled by reportScrollMetrics.
  useEffect(() => {
    followScrollTailRef.current = shouldFollowScrollTail;
    setScrollOffset(shouldFollowScrollTail ? maxScrollOffset : 0);
  }, [scrollContextKey]);

  const updateScrollOffset = (update: (offset: number) => number) => {
    setScrollOffset((offset) => {
      const next = Math.max(0, Math.min(maxScrollOffset, update(offset)));
      if (shouldFollowScrollTail) followScrollTailRef.current = next === maxScrollOffset;
      return next;
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets task-select mode whenever the active tab changes, not on any value read inside
  useEffect(() => {
    setTaskSelectMode(false);
  }, [tab]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets agent-select mode whenever the active tab changes, not on any value read inside
  useEffect(() => {
    setAgentSelectMode(false);
  }, [tab]);

  useInput((input, key) => {
    if (openTask) {
      if (key.pageUp) {
        updateScrollOffset((offset) => offset - scrollPageSize);
        return;
      }
      if (key.pageDown) {
        updateScrollOffset((offset) => offset + scrollPageSize);
        return;
      }
      if (key.upArrow) {
        updateScrollOffset((offset) => offset - SCROLL_STEP);
        return;
      }
      if (key.downArrow) {
        updateScrollOffset((offset) => offset + SCROLL_STEP);
        return;
      }

      if (key.escape) {
        setOpenTask(null);
        return;
      }
      if (input === 'c') {
        setTaskConsoleExpanded((expanded) => !expanded);
        return;
      }
      return;
    }

    // Command-suggestions navigation takes priority over tab-switching/scrolling — it only ever
    // activates while the conversation box is open AND the draft is a recognized-mode command
    // prefix (matchCommands returns [] otherwise), so it can't shadow Tab/arrows the rest of the
    // time. Enter is handled by ArchitectConversationInput's own onSubmit, same as the home
    // screen's pattern, not here.
    if (commandSuggestions.length > 0) {
      if (key.upArrow) {
        setSuggestionIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setSuggestionIndex((index) => Math.min(commandSuggestions.length - 1, index + 1));
        return;
      }
      if (key.tab) {
        const clampedIndex = Math.min(suggestionIndex, commandSuggestions.length - 1);
        setDraft(`/${commandSuggestions[clampedIndex]?.name ?? ''} `);
        return;
      }
    }

    if (key.tab) {
      const currentIndex = TABS.indexOf(tab);
      const nextIndex = key.shift
        ? (currentIndex - 1 + TABS.length) % TABS.length
        : (currentIndex + 1) % TABS.length;
      setTab(TABS[nextIndex]);
      return;
    }

    if (!conversationMode && tab === 'overview' && tasks.length > 0 && input === 's') {
      setTaskSelectMode((mode) => !mode);
      return;
    }

    if (!conversationMode && tab === 'overview' && taskSelectMode && tasks.length > 0) {
      if (key.upArrow) {
        setSelectedTaskIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedTaskIndex((index) => Math.min(tasks.length - 1, index + 1));
        return;
      }
      if (key.return && selectedTask) {
        setOpenTask(selectedTask);
        return;
      }
    }

    if (!conversationMode && tab === 'console' && agents.length > 0 && input === 's') {
      setAgentSelectMode((mode) => !mode);
      return;
    }

    if (!conversationMode && tab === 'console' && agentSelectMode && agents.length > 0) {
      if (key.upArrow) {
        setSelectedAgentIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedAgentIndex((index) => Math.min(agents.length - 1, index + 1));
        return;
      }
      if (key.return) {
        setSelectedAgentId(agents[selectedAgentIndex]?.agentId ?? null);
        setAgentSelectMode(false);
        return;
      }
    }

    if (key.pageUp) {
      updateScrollOffset((offset) => offset - scrollPageSize);
      return;
    }
    if (key.pageDown) {
      updateScrollOffset((offset) => offset + scrollPageSize);
      return;
    }
    if (key.upArrow) {
      updateScrollOffset((offset) => offset - SCROLL_STEP);
      return;
    }
    if (key.downArrow) {
      updateScrollOffset((offset) => offset + SCROLL_STEP);
      return;
    }

    if (conversationMode) {
      if (key.escape) {
        if (draft) setDraft('');
        else onBack();
      }
      return;
    }

    if (key.escape) {
      if (selectedAgentId) {
        setSelectedAgentId(null);
        return;
      }
      onBack();
      return;
    }
    if (busy) return;
    if (input === 'x' && run.phase === 'implementation') {
      void abort();
    }
  });

  const commandHints: CommandHint[] = openTask
    ? [
        { key: 'Esc', label: 'back to diagram' },
        { key: 'c', label: taskConsoleExpanded ? 'show task definition' : 'expand console' },
      ]
    : commandSuggestions.length > 0
      ? [
          { key: '↑/↓', label: 'select command' },
          { key: 'Tab', label: 'complete command' },
          { key: 'Esc', label: 'back' },
        ]
      : [
          { key: 'Tab', label: 'switch tab' },
          { key: 'Esc', label: 'back' },
        ];
  if (!openTask) {
    if (run.phase === 'definition') {
      commandHints.push({ key: '/approve · /abort', label: 'plan actions' });
    }
    if (run.phase === 'implementation') commandHints.push({ key: 'x', label: 'abort' });
    if (!conversationMode && tab === 'overview' && tasks.length > 0) {
      commandHints.push({ key: 's', label: taskSelectMode ? 'exit task select' : 'select task' });
      if (taskSelectMode) {
        commandHints.push(
          { key: '↑/↓', label: 'select task' },
          { key: 'Enter', label: 'open task' },
        );
      }
    }
    if (!conversationMode && tab === 'console' && agents.length > 0) {
      commandHints.push({
        key: 's',
        label: agentSelectMode ? 'exit agent select' : 'select agent',
      });
      if (agentSelectMode) {
        commandHints.push(
          { key: '↑/↓', label: 'select agent' },
          { key: 'Enter', label: 'confirm agent' },
        );
      }
    }
  }
  const arrowsSelectTasks =
    !openTask && !conversationMode && tab === 'overview' && taskSelectMode && tasks.length > 0;
  const arrowsSelectAgents =
    !conversationMode && tab === 'console' && agentSelectMode && agents.length > 0;
  // While the command dropdown is up, ↑/↓ navigate it (see the useInput handler above) rather
  // than scroll — a "scroll" hint bound to the same keys at the same time would be misleading,
  // and would also collide with the dropdown's own ↑/↓ hint above as a duplicate React key.
  if (
    commandSuggestions.length === 0 &&
    scrollMetrics.contentHeight > scrollMetrics.viewportHeight
  ) {
    const from = scrollOffset + 1;
    const to = Math.min(scrollMetrics.contentHeight, scrollOffset + scrollMetrics.viewportHeight);
    commandHints.push(
      arrowsSelectTasks || arrowsSelectAgents
        ? {
            key: 'PageUp/PageDown',
            label: `scroll (${from}-${to}/${scrollMetrics.contentHeight})`,
          }
        : { key: '↑/↓', label: `scroll (${from}-${to}/${scrollMetrics.contentHeight})` },
    );
  }

  const tabBarWidth = TABS.map((candidate) => tabText(candidate, tab)).join(' ').length;
  const titleMaxWidth = Math.max(
    0,
    width - HEADER_LABEL.length - tabBarWidth - HEADER_MARGIN - MIN_TITLE_GAP,
  );
  const title = truncateTitle(run.title, titleMaxWidth);
  const { label: statusText, color: statusColor } = statusLabel(busy, waitingForArchitect);

  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <GradientText>{HEADER_LABEL}</GradientText>
          <Text wrap="truncate-end"> {title}</Text>
        </Box>
        <TabBar tab={tab} />
      </Box>
      <Box marginBottom={1}>
        <Text color={INACTIVE}>{'─'.repeat(width)}</Text>
      </Box>
      <Box height={bodyHeight} overflow="hidden" alignItems="flex-start">
        {liveOpenTask ? (
          <TaskDetailPanel
            task={liveOpenTask}
            content={taskFileContent}
            loading={taskFileLoading}
            error={taskFileError}
            events={events}
            eventTimestamps={eventTimestamps}
            width={width}
            height={bodyHeight}
            expanded={taskConsoleExpanded}
            scrollOffset={scrollOffset}
            onScrollMetrics={reportScrollMetrics}
          />
        ) : tab === 'planification' ? (
          <ScrollBox
            height={bodyHeight}
            scrollOffset={scrollOffset}
            onContentHeight={(contentHeight) =>
              reportScrollMetrics({ contentHeight, viewportHeight: bodyHeight })
            }
          >
            {run.phase === 'grilling' && grillingQuestion ? (
              <GrillingPanel
                question={grillingQuestion.question}
                recommendation={grillingQuestion.recommendation}
                width={width}
              />
            ) : pendingConsultation ? (
              <ConsultationPanel
                taskId={pendingConsultation.taskId}
                failureReason={pendingConsultation.failureReason}
                question={pendingConsultation.question}
                recommendation={pendingConsultation.recommendation}
                extraCount={consultations.size - 1}
                width={width}
              />
            ) : (
              <PlanificationPanel
                run={run}
                plan={plan}
                planError={planError}
                config={config}
                latestArchitectEvent={latestArchitectEvent}
                revising={revising}
                width={width}
              />
            )}
          </ScrollBox>
        ) : tab === 'overview' ? (
          <ExecutionPanel
            plan={plan}
            events={events}
            eventTimestamps={eventTimestamps}
            width={width}
            height={bodyHeight}
            scrollOffset={scrollOffset}
            onScrollMetrics={reportScrollMetrics}
            selectedTaskId={taskSelectMode ? (selectedTask?.id ?? null) : null}
          />
        ) : (
          <ConsolePanel
            events={events}
            eventTimestamps={eventTimestamps}
            selectedAgentId={consoleDisplayedAgentId}
            width={width}
            height={bodyHeight}
            scrollOffset={scrollOffset}
            onScrollMetrics={reportScrollMetrics}
          />
        )}
      </Box>
      <Box ref={footerRef} flexDirection="column">
        {status && (
          <Box marginTop={1}>
            <Text dimColor>{status}</Text>
          </Box>
        )}
        <Box marginTop={1} justifyContent="space-between">
          <CommandHints hints={commandHints} />
          {conversationMode && <Text color={statusColor}>{statusText}</Text>}
        </Box>
        {conversationMode && (
          <Box marginTop={1}>
            <ArchitectConversationInput
              mode={conversationMode}
              value={draft}
              onChange={setDraft}
              onSubmit={submitConversation}
              busy={busy}
              width={width}
            />
          </Box>
        )}
        {conversationMode && commandSuggestions.length > 0 && (
          <CommandSuggestions
            commands={commandSuggestions}
            selectedIndex={Math.min(suggestionIndex, commandSuggestions.length - 1)}
          />
        )}
        {pendingConsultation && openTask && (
          <Box marginTop={1}>
            <Text color={WAITING}>The Architect is waiting for your reply — Esc to go back.</Text>
          </Box>
        )}
        {showBlockedMessage && (
          <Box marginTop={1}>
            <Text color={hasFailedTask ? ERROR : WAITING}>
              {hasFailedTask
                ? 'Project blocked by a failed task — the Architect will ask you what to do.'
                : 'A task is waiting on you — see Overview.'}
            </Text>
          </Box>
        )}
        <Box marginTop={1}>
          <StatusBar left={run.cwd} hints={[]} />
        </Box>
      </Box>
    </Box>
  );
}
