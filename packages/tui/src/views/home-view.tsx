import type { ArchClient } from '@losina/daemon-client';
import type { AgentMeshConfig, RunMeta } from '@losina/schemas';
import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { matchHomeCommands, parseHomeInput } from '../commands.js';
import { CommandSuggestions } from '../components/command-suggestions.js';
import { HelpModal } from '../components/help-modal.js';
import { Logo } from '../components/logo.js';
import { DEFAULT_BOOT_ANIMATION_MS, MatrixLogoReveal } from '../components/matrix-logo-reveal.js';
import { ModelsHint } from '../components/models-hint.js';
import { PromptBox } from '../components/prompt-box.js';
import { SettingsModal } from '../components/settings-modal.js';
import { StatusBar } from '../components/status-bar.js';
import { filterRuns } from '../fuzzy-match.js';
import { useTerminalColumns } from '../hooks/use-terminal-columns.js';
import { useTerminalRows } from '../hooks/use-terminal-rows.js';
import { exitApp } from '../lib/exit-app.js';
import { ACCENT, ERROR, SELECTION_CURSOR } from '../theme.js';

interface HomeViewProps {
  client: ArchClient;
  cwd: string;
  onOpenRun: (run: RunMeta) => void;
  /** Duration of the boot splash reveal. 0 skips straight to the splash screen (used in tests). */
  bootAnimationMs?: number;
}

type Screen = 'boot' | 'splash' | 'runs';

export function HomeView({
  client,
  cwd,
  onOpenRun,
  bootAnimationMs = DEFAULT_BOOT_ANIMATION_MS,
}: HomeViewProps) {
  const rows = useTerminalRows();
  const columns = useTerminalColumns();
  const [screen, setScreen] = useState<Screen>(bootAnimationMs > 0 ? 'boot' : 'splash');
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<AgentMeshConfig | null>(null);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');
  const [runsQuery, setRunsQuery] = useState('');
  const [runsIndex, setRunsIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<RunMeta | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const filteredRuns = filterRuns(runs, runsQuery);
  const commandSuggestions = matchHomeCommands(input);

  useEffect(() => {
    client
      .listRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [client]);

  useEffect(() => {
    client
      .getConfig()
      .then(setConfig)
      .catch(() => {});
  }, [client]);

  const updateInput = (value: string) => {
    setInput(value);
    if (status) setStatus('');
  };

  const runCommand = (name: string) => {
    if (name === 'runs') {
      setRunsQuery('');
      setRunsIndex(0);
      setScreen('runs');
    } else if (name === 'settings') {
      setSettingsOpen(true);
    } else if (name === 'help') {
      setHelpOpen(true);
    } else if (name === 'quit') {
      void exitApp(client);
    } else if (name === 'close-all') {
      void exitApp(client, { force: true });
    }
  };

  const handleSubmit = async (value: string) => {
    const parsed = parseHomeInput(value);
    if (parsed.kind === 'empty') return;

    if (parsed.kind === 'command') {
      setInput('');
      if (parsed.known) {
        runCommand(parsed.name);
      } else {
        setStatus(`Unknown command: /${parsed.name} — try /help`);
      }
      return;
    }

    if (creating) return;
    setCreating(true);
    setStatus('Starting run…');
    try {
      const run = await client.createRun({ prompt: parsed.prompt, cwd });
      setInput('');
      onOpenRun(run);
    } catch (error) {
      setStatus(`Failed to start run: ${(error as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await client.deleteRun({ runId: deleteTarget.runId });
      setRuns((previous) => previous.filter((run) => run.runId !== deleteTarget.runId));
      setRunsIndex(0);
      setDeleteError('');
    } catch (error) {
      setDeleteError(`Failed to delete run: ${(error as Error).message}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  useInput((char, key) => {
    if (helpOpen) {
      if (key.escape || key.return) setHelpOpen(false);
      return;
    }

    if (settingsOpen) return;

    if (screen === 'boot' || screen === 'splash') return;

    if (deleteTarget) {
      if (char === 'y') void confirmDelete();
      if (char === 'n' || key.escape) setDeleteTarget(null);
      return;
    }

    if (key.escape) {
      if (runsQuery) {
        setRunsQuery('');
        setRunsIndex(0);
      } else {
        setScreen('splash');
      }
      return;
    }
    if (key.upArrow) {
      setRunsIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setRunsIndex((index) => Math.min(filteredRuns.length - 1, index + 1));
      return;
    }
    if (key.return) {
      const run = filteredRuns[runsIndex];
      if (run) onOpenRun(run);
      return;
    }
    if (key.ctrl && char === 'd') {
      const run = filteredRuns[runsIndex];
      if (run) {
        setDeleteError('');
        setDeleteTarget(run);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setRunsQuery((query) => query.slice(0, -1));
      setRunsIndex(0);
      return;
    }
    if (char) {
      setRunsQuery((query) => query + char);
      setRunsIndex(0);
    }
  });

  const statusBarHints =
    helpOpen || settingsOpen
      ? ['esc to close']
      : screen === 'boot'
        ? []
        : screen === 'splash'
          ? ['type to start a run', '/help commands']
          : deleteTarget
            ? ['y confirm', 'n cancel']
            : ['type to filter', '↑/↓ select', 'enter open', 'ctrl+d delete', 'esc back'];

  const contentRows = Math.max(0, rows - 1);
  const dimSplash = helpOpen || settingsOpen;

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexGrow={1} position="relative">
        <Box
          width={columns}
          height={contentRows}
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          {screen === 'boot' && (
            <MatrixLogoReveal
              durationMs={bootAnimationMs}
              viewportColumns={columns}
              viewportRows={contentRows}
              // marginTop(3) + PromptBox (GradientBox border: 3 rows, marginTop 1, hint 1) — keeps
              // the animation's resting position aligned with where the splash layout puts the logo.
              restingBelowRows={8}
              onComplete={() => setScreen('splash')}
            />
          )}

          {screen === 'splash' && (
            <Box flexDirection="column" alignItems="center">
              <Logo dim={dimSplash} />
              <Box marginTop={3}>
                <PromptBox
                  value={input}
                  onChange={updateInput}
                  onSubmit={handleSubmit}
                  placeholder={
                    creating ? 'Starting run…' : 'Describe your task and give instructions'
                  }
                  hint={
                    commandSuggestions.length > 0 ? (
                      <CommandSuggestions commands={commandSuggestions} />
                    ) : (
                      status || (config && <ModelsHint config={config} dim={dimSplash} />) || ''
                    )
                  }
                  dim={dimSplash}
                />
              </Box>
            </Box>
          )}

          {screen === 'runs' && (
            <Box flexDirection="column" width="70%">
              <Text bold color={ACCENT}>
                Runs
              </Text>
              <Box marginTop={1}>
                <Text dimColor>/ {runsQuery}</Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                {filteredRuns.length === 0 && runs.length === 0 && (
                  <Text dimColor>No runs yet — go back and describe a task to start one.</Text>
                )}
                {filteredRuns.length === 0 && runs.length > 0 && (
                  <Text dimColor>No runs match "{runsQuery}".</Text>
                )}
                {filteredRuns.map((run, index) => (
                  <Text key={run.runId} color={index === runsIndex ? ACCENT : undefined}>
                    {index === runsIndex ? `${SELECTION_CURSOR} ` : '  '}[{run.phase}] {run.title}
                  </Text>
                ))}
              </Box>
              {deleteTarget && (
                <Box marginTop={1}>
                  <Text color={ERROR}>
                    Delete "{deleteTarget.title}"? This cannot be undone. (y/n)
                  </Text>
                </Box>
              )}
              {!deleteTarget && deleteError && (
                <Box marginTop={1}>
                  <Text color={ERROR}>{deleteError}</Text>
                </Box>
              )}
            </Box>
          )}
        </Box>

        {helpOpen && <HelpModal columns={columns} rows={contentRows} />}
        {settingsOpen && (
          <SettingsModal
            client={client}
            columns={columns}
            rows={contentRows}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </Box>

      <StatusBar left={cwd} hints={statusBarHints} />
    </Box>
  );
}
