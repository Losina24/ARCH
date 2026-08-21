import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

const DEFAULT_ROWS = 24;

/**
 * Node's stdout doesn't emit an initial size — only `resize` on later
 * changes — and `rows` is undefined outside a real TTY (e.g. under the
 * ink-testing-library mock), hence the fallback.
 */
export function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows ?? DEFAULT_ROWS);

  useEffect(() => {
    const handleResize = () => setRows(stdout.rows ?? DEFAULT_ROWS);
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  return rows;
}
