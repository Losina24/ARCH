import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

const DEFAULT_COLUMNS = 80;
const POLL_INTERVAL_MS = 500;

/**
 * Node's stdout doesn't emit an initial size — only `resize` on later
 * changes — and `columns` is undefined outside a real TTY (e.g. under the
 * ink-testing-library mock), hence the fallback.
 *
 * Some terminals (Warp in particular, at least when the window is
 * maximized) don't reliably emit `resize`, leaving `stdout.columns` stale.
 * A cheap interval poll acts as a safety net so the layout still catches up.
 */
export function useTerminalColumns(): number {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout.columns ?? DEFAULT_COLUMNS);

  useEffect(() => {
    const sync = () => {
      const next = stdout.columns ?? DEFAULT_COLUMNS;
      setColumns((current) => (current === next ? current : next));
    };
    stdout.on('resize', sync);
    const interval = setInterval(sync, POLL_INTERVAL_MS);
    return () => {
      stdout.off('resize', sync);
      clearInterval(interval);
    };
  }, [stdout]);

  return columns;
}
