import { type ArchClient, ensureDaemon } from '@arch/daemon-client';
import type { RunMeta } from '@arch/schemas';
import { Text, useStdout } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { exitApp } from './lib/exit-app.js';
import { HomeView } from './views/home-view.js';
import { RunDetailView } from './views/run-detail-view.js';

type Screen = { name: 'home' } | { name: 'run-detail'; run: RunMeta };

// Full-screen transitions must land on a genuinely blank terminal — Ink's own
// erase-and-redraw diffing can undercount rows when prior content wrapped,
// leaving stale content from the previous screen visible above the new one.
// A raw hard clear right before the state change (rather than relying on
// Ink's diff) guarantees nothing survives underneath the next paint.
const HARD_CLEAR = '\x1B[2J\x1B[H';

export function App({ cwd }: { cwd: string }) {
  const { stdout } = useStdout();
  const [client, setClient] = useState<ArchClient | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [error, setError] = useState<string | null>(null);
  // HomeView fully unmounts while a run is open, so returning to it is a fresh mount that
  // would otherwise replay its boot animation every time — this tracks the real first boot
  // across that remount so it only ever plays once per process.
  const hasBootedRef = useRef(false);

  useEffect(() => {
    ensureDaemon(cwd)
      .then(setClient)
      .catch((connectError: Error) => setError(connectError.message));
  }, [cwd]);

  // Ctrl+C/SIGTERM has no in-app command to intercept it, so it needs its own
  // handler to get the same "leave the daemon running if a run is active"
  // treatment as /quit, instead of Node's default of exiting the TUI while
  // leaving stray state behind.
  useEffect(() => {
    const handleSignal = () => {
      void exitApp(client);
    };
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    return () => {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
    };
  }, [client]);

  const navigate = (next: Screen) => {
    stdout.write(HARD_CLEAR);
    if (next.name === 'home') hasBootedRef.current = true;
    setScreen(next);
  };

  if (error) {
    return <Text color="red">Failed to connect to ARCH daemon: {error}</Text>;
  }

  if (!client) {
    return <Text dimColor>Connecting to ARCH daemon…</Text>;
  }

  if (screen.name === 'run-detail') {
    return (
      <RunDetailView client={client} run={screen.run} onBack={() => navigate({ name: 'home' })} />
    );
  }

  return (
    <HomeView
      client={client}
      cwd={cwd}
      bootAnimationMs={hasBootedRef.current ? 0 : undefined}
      onOpenRun={(run) => navigate({ name: 'run-detail', run })}
    />
  );
}
